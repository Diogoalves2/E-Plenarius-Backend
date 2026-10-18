import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { mkdir, readdir, rm, stat, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { once } from 'events';
import { Recording } from './entities/recording.entity';
import { TranscriptSegment } from './entities/transcript-segment.entity';
import { TranscriptionProvider, sanitizeKeywords } from './transcription.provider';
import { detectSilences, extractChunk, normalizeAudio, planChunks, probeDuration } from './audio.util';
import { AuditService } from '../audit/audit.service';
import { canonicalJson, sha256 } from '../common/integrity';

const PART_SIZE = 20 * 1024 * 1024; // cabe no limite do Nginx (25 MB)
const MAX_SIZE = 6 * 1024 * 1024 * 1024;
const ALLOWED_EXT = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.mp4', '.webm', '.mov'];
const CONCURRENCY = 3;

const REGIMENTAL_TERMS = [
  'Ordem do Dia', 'Pequeno Expediente', 'Grande Expediente', 'Explicações Pessoais', 'Mesa Diretora',
  'Excelentíssimo', 'Excelentíssima', 'Vossa Excelência', 'Projeto de Lei', 'Projeto de Resolução',
  'Projeto de Decreto Legislativo', 'Lei Orgânica', 'Requerimento', 'Indicação', 'Moção', 'aparte',
  'quórum', 'Regimento Interno', 'vereador', 'vereadora', 'Presidente', 'Vice-presidente', '1º Secretário',
];

export interface CreateRecordingDto { fileName: string; sizeBytes: number; recordedStartAt?: string }

@Injectable()
export class RecordingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly dir = join(process.env.UPLOADS_DIR || join(process.cwd(), 'uploads'), 'recordings');
  private readonly queue: string[] = [];
  private running = false;

  constructor(
    @InjectRepository(Recording) private readonly recs: Repository<Recording>,
    @InjectRepository(TranscriptSegment) private readonly segs: Repository<TranscriptSegment>,
    private readonly dataSource: DataSource,
    private readonly provider: TranscriptionProvider,
    private readonly audit: AuditService,
  ) {}

  /** Processamento é em memória: o que estava rodando quando o servidor reiniciou volta como erro. */
  async onApplicationBootstrap() {
    await mkdir(join(this.dir, 'tmp'), { recursive: true });
    await this.recs.createQueryBuilder().update(Recording)
      .set({ status: 'erro', error: 'Processamento interrompido (servidor reiniciado). Use "Reprocessar".' })
      .where('status IN (:...s)', { s: ['na_fila', 'processando'] })
      .execute();
  }

  private tmpDir(id: string) { return join(this.dir, 'tmp', id); }

  // ── Envio em partes ─────────────────────────────────────────────────────

  async create(session: { id: string; chamberId: string; startedAt: Date | null }, userId: string, dto: CreateRecordingDto) {
    const ext = extname(dto.fileName ?? '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) throw new BadRequestException(`Formato não suportado (${ext || 'sem extensão'}). Use WAV, MP3, M4A, OGG, FLAC ou vídeo MP4.`);
    const size = Number(dto.sizeBytes);
    if (!Number.isInteger(size) || size <= 0 || size > MAX_SIZE) throw new BadRequestException('Tamanho de arquivo inválido (máx. 6 GB).');

    const active = await this.recs.findOne({ where: { sessionId: session.id }, order: { createdAt: 'DESC' } });
    if (active && active.status !== 'erro') {
      throw new ConflictException('Esta sessão já tem uma gravação. Exclua a atual para enviar outra.');
    }

    const startAt = dto.recordedStartAt ? new Date(dto.recordedStartAt) : session.startedAt;
    const rec = await this.recs.save(this.recs.create({
      sessionId: session.id,
      chamberId: session.chamberId,
      fileName: dto.fileName.slice(0, 200),
      sizeBytes: String(size),
      partsTotal: Math.ceil(size / PART_SIZE),
      recordedStartAt: startAt && !isNaN(+startAt) ? startAt : null,
      status: 'enviando',
      createdById: userId,
    }));
    await mkdir(this.tmpDir(rec.id), { recursive: true });
    return { ...rec, partSize: PART_SIZE };
  }

  async putPart(rec: Recording, n: number, body: Buffer) {
    if (rec.status !== 'enviando') throw new ConflictException('Envio já concluído');
    if (!Number.isInteger(n) || n < 0 || n >= rec.partsTotal) throw new BadRequestException('Parte inválida');
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > PART_SIZE) throw new BadRequestException('Conteúdo da parte inválido');
    await mkdir(this.tmpDir(rec.id), { recursive: true });
    await writeFile(join(this.tmpDir(rec.id), `${String(n).padStart(5, '0')}.part`), body);
    const received = (await readdir(this.tmpDir(rec.id))).filter(f => f.endsWith('.part')).length;
    await this.recs.update(rec.id, { partsReceived: received });
    return { received, total: rec.partsTotal };
  }

  async complete(rec: Recording) {
    if (rec.status !== 'enviando') throw new ConflictException('Envio já concluído');
    const dir = this.tmpDir(rec.id);
    const parts = (await readdir(dir)).filter(f => f.endsWith('.part')).sort();
    if (parts.length !== rec.partsTotal) throw new BadRequestException(`Faltam partes: ${parts.length}/${rec.partsTotal}`);

    const original = join(dir, `original${extname(rec.fileName).toLowerCase()}`);
    const out = createWriteStream(original);
    for (const p of parts) {
      for await (const chunk of createReadStream(join(dir, p))) {
        if (!out.write(chunk)) await once(out, 'drain');
      }
      await unlink(join(dir, p));
    }
    await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
    const { size } = await stat(original);
    if (size !== Number(rec.sizeBytes)) {
      await this.fail(rec.id, `Arquivo incompleto (${size} de ${rec.sizeBytes} bytes). Envie novamente.`);
      throw new BadRequestException('Arquivo incompleto');
    }
    await this.recs.update(rec.id, { status: 'na_fila', progress: 0, error: null });
    this.enqueue(rec.id);
    return this.findOne(rec.id);
  }

  // ── Fila de processamento (um por vez: a VPS é compartilhada) ────────────

  enqueue(id: string) {
    if (!this.queue.includes(id)) this.queue.push(id);
    void this.drain();
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        try { await this.process(id); }
        catch (err: any) {
          this.logger.error(`degravação ${id} falhou: ${err?.message}`);
          await this.fail(id, err?.message ?? 'Falha no processamento');
        }
      }
    } finally { this.running = false; }
  }

  private async fail(id: string, error: string) {
    await this.recs.update(id, { status: 'erro', error: error.slice(0, 1000) });
  }

  private async process(id: string) {
    const rec = await this.recs.findOne({ where: { id } });
    if (!rec) return;
    const cfgErr = this.provider.configError();
    if (cfgErr) return this.fail(id, cfgErr);

    await this.recs.update(id, { status: 'processando', progress: 1, error: null });
    const work = this.tmpDir(id);
    await mkdir(work, { recursive: true });

    // 1) Áudio de trabalho (mantido para o player e para reprocessar)
    let mp3Path = rec.audioUrl ? join(this.dir, rec.audioUrl.split('/').pop()!) : null;
    if (!mp3Path || !existsSync(mp3Path)) {
      const original = (await readdir(work)).find(f => f.startsWith('original'));
      if (!original) throw new Error('Arquivo original não encontrado. Envie a gravação novamente.');
      const name = `${randomBytes(16).toString('hex')}.mp3`;
      mp3Path = join(this.dir, name);
      await normalizeAudio(join(work, original), mp3Path);
      await unlink(join(work, original));
      await this.recs.update(id, { audioUrl: `/uploads/recordings/${name}` });
    }
    const duration = await probeDuration(mp3Path);
    await this.recs.update(id, { durationSec: duration, progress: 5 });

    // 2) Trechos de fala (corte nas pausas)
    const chunks = planChunks(duration, await detectSilences(mp3Path));
    await this.recs.update(id, { progress: 8 });

    // 3) Contexto da câmara: melhora nomes próprios, siglas e números de projetos
    const ctx = await this.context(rec.sessionId, rec.chamberId);
    const timeline = await this.speakerTimeline(rec.sessionId);
    const startAt = rec.recordedStartAt ? new Date(rec.recordedStartAt).getTime() : null;

    await this.segs.delete({ recordingId: id });
    const results: (TranscriptSegment | null)[] = new Array(chunks.length).fill(null);
    let next = 0, done = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const i = next++;
        const c = chunks[i];
        const file = join(work, `c${i}.mp3`);
        await extractChunk(mp3Path!, c, file);
        const r = await this.provider.transcribe(file, ctx, i);
        await unlink(file).catch(() => {});
        if (r.text) {
          const at = startAt != null ? startAt + ((c.start + c.end) / 2) * 1000 : null;
          results[i] = this.segs.create({
            recordingId: id, idx: i, startSec: c.start, endSec: c.end,
            speaker: at != null ? this.speakerAt(timeline, at) : null,
            text: r.text, confidence: r.confidence,
            needsReview: (r.confidence != null && r.confidence < 0.6) || /\d/.test(r.text),
          });
        }
        done++;
        if (done % 5 === 0 || done === chunks.length) {
          await this.recs.update(id, { progress: 8 + Math.round((done / Math.max(chunks.length, 1)) * 90) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length || 1) }, worker));

    const segments = results.filter(Boolean) as TranscriptSegment[];
    segments.forEach((s, n) => { s.idx = n; });
    await this.segs.save(segments, { chunk: 200 });
    await this.recs.update(id, { status: 'transcrito', progress: 100, model: this.provider.model });
    await rm(work, { recursive: true, force: true });
    this.logger.log(`degravação ${id}: ${segments.length} trechos de ${chunks.length}, ${Math.round(duration / 60)} min`);
  }

  private async context(sessionId: string, chamberId: string) {
    const [chamber] = await this.dataSource.query(`SELECT name, city, state FROM chambers WHERE id = $1`, [chamberId]);
    const [session] = await this.dataSource.query(`SELECT number, type FROM sessions WHERE id = $1`, [sessionId]);
    const members = await this.dataSource.query(
      `SELECT name, party FROM users WHERE "chamberId" = $1 AND "isActive" = true`, [chamberId]);
    const items = await this.dataSource.query(
      `SELECT number, "authorName" FROM agenda_items WHERE "sessionId" = $1 ORDER BY "orderIndex"`, [sessionId]);
    const keywords = sanitizeKeywords([
      chamber?.name, chamber?.city,
      ...members.map((m: any) => m.name),
      ...members.map((m: any) => m.party),
      ...items.map((i: any) => i.number),
      ...items.map((i: any) => i.authorName),
      ...REGIMENTAL_TERMS,
    ]);
    const prompt = `Gravação da ${session?.number ?? ''}ª sessão ${session?.type ?? ''} da ${chamber?.name ?? 'Câmara Municipal'}`
      + ` (${chamber?.city ?? ''}/${chamber?.state ?? ''}). Português do Brasil, linguagem parlamentar formal.`;
    return { keywords, prompt };
  }

  /** Quem estava com a palavra (falas e apartes do expediente) em cada instante. */
  private async speakerTimeline(sessionId: string) {
    const logs: { action: string; detail: any; at: Date }[] = await this.dataSource.query(
      `SELECT action, detail, "createdAt" AS at FROM audit_logs
        WHERE "sessionId" = $1 AND (action LIKE 'fala:%' OR action LIKE 'aparte:%')
        ORDER BY seq NULLS FIRST, "createdAt"`, [sessionId]);
    const falas: { from: number; to: number; speaker: string }[] = [];
    const apartes: { from: number; to: number; speaker: string }[] = [];
    let fala: { from: number; speaker: string } | null = null;
    let aparte: { from: number; speaker: string } | null = null;
    for (const l of logs) {
      const t = new Date(l.at).getTime();
      if (l.action === 'fala:iniciada') {
        if (fala) falas.push({ ...fala, to: t });
        fala = l.detail?.orador ? { from: t, speaker: l.detail.orador } : null;
      } else if (l.action === 'fala:encerrada' && fala) {
        falas.push({ ...fala, to: t }); fala = null;
      } else if (l.action === 'aparte:iniciado') {
        aparte = { from: t, speaker: l.detail?.aparteante ?? l.detail?.orador };
      } else if (l.action === 'aparte:encerrado' && aparte) {
        apartes.push({ ...aparte, to: t }); aparte = null;
      }
    }
    if (fala) falas.push({ ...fala, to: Number.MAX_SAFE_INTEGER });
    if (aparte) apartes.push({ ...aparte, to: Number.MAX_SAFE_INTEGER });
    return { falas, apartes };
  }

  private speakerAt(tl: { falas: any[]; apartes: any[] }, at: number): string | null {
    return tl.apartes.find(a => at >= a.from && at < a.to)?.speaker
      ?? tl.falas.find(f => at >= f.from && at < f.to)?.speaker
      ?? null;
  }

  // ── Consulta, revisão e aprovação ───────────────────────────────────────

  async findOne(id: string) {
    const rec = await this.recs.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('Gravação não encontrada');
    return rec;
  }

  listBySession(sessionId: string) {
    return this.recs.find({ where: { sessionId }, order: { createdAt: 'DESC' } });
  }

  async detail(id: string) {
    const rec = await this.findOne(id);
    const segments = await this.segs.find({ where: { recordingId: id }, order: { idx: 'ASC' } });
    return { ...rec, segments };
  }

  async editSegment(rec: Recording, segId: string, dto: { text?: string; speaker?: string | null; reviewed?: boolean }) {
    if (rec.status !== 'transcrito') throw new ConflictException(rec.status === 'aprovado'
      ? 'Degravação aprovada: reabra para editar.' : 'Degravação ainda não está pronta para revisão.');
    const seg = await this.segs.findOne({ where: { id: segId, recordingId: rec.id } });
    if (!seg) throw new NotFoundException('Trecho não encontrado');
    if (dto.text !== undefined) {
      const t = dto.text.replace(/\s+/g, ' ').trim().slice(0, 5000);
      seg.editedText = t === seg.text ? null : t;
      seg.reviewed = true;
    }
    if (dto.speaker !== undefined) seg.speaker = dto.speaker?.trim().slice(0, 120) || null;
    if (dto.reviewed !== undefined) seg.reviewed = dto.reviewed;
    return this.segs.save(seg);
  }

  private hashOf(segments: TranscriptSegment[]) {
    return sha256(canonicalJson(segments.map(s => ({
      i: s.idx, start: Math.round(s.startSec * 1000), end: Math.round(s.endSec * 1000),
      speaker: s.speaker ?? null, text: s.editedText ?? s.text,
    }))));
  }

  async approve(rec: Recording, userId: string) {
    if (rec.status !== 'transcrito') throw new ConflictException('Só é possível aprovar uma degravação transcrita.');
    const segments = await this.segs.find({ where: { recordingId: rec.id }, order: { idx: 'ASC' } });
    const pending = segments.filter(s => s.needsReview && !s.reviewed).length;
    if (pending) throw new BadRequestException(`Há ${pending} trecho(s) marcado(s) para conferência ainda não revisado(s).`);
    const hash = this.hashOf(segments);
    await this.recs.update(rec.id, { status: 'aprovado', approvedById: userId, approvedAt: new Date(), transcriptHash: hash });
    await this.audit.log({
      chamberId: rec.chamberId, sessionId: rec.sessionId, userId, action: 'degravacao:aprovada',
      targetType: 'recording', targetId: rec.id,
      detail: { hash, trechos: segments.length, corrigidos: segments.filter(s => s.editedText != null).length },
    });
    return this.findOne(rec.id);
  }

  async reopen(rec: Recording, userId: string) {
    if (rec.status !== 'aprovado') throw new ConflictException('Degravação não está aprovada.');
    await this.recs.update(rec.id, { status: 'transcrito', approvedById: null, approvedAt: null, transcriptHash: null });
    await this.audit.log({
      chamberId: rec.chamberId, sessionId: rec.sessionId, userId, action: 'degravacao:reaberta',
      targetType: 'recording', targetId: rec.id, detail: { hashAnterior: rec.transcriptHash },
    });
    return this.findOne(rec.id);
  }

  async reprocess(rec: Recording) {
    if (!['erro', 'transcrito'].includes(rec.status)) throw new ConflictException('Só é possível reprocessar com erro ou antes da aprovação.');
    await this.recs.update(rec.id, { status: 'na_fila', progress: 0, error: null });
    this.enqueue(rec.id);
    return this.findOne(rec.id);
  }

  async remove(rec: Recording) {
    if (rec.status === 'aprovado') throw new ConflictException('Degravação aprovada não pode ser excluída. Reabra antes.');
    if (['na_fila', 'processando'].includes(rec.status)) throw new ConflictException('Aguarde o fim do processamento.');
    await rm(this.tmpDir(rec.id), { recursive: true, force: true });
    if (rec.audioUrl) await unlink(join(this.dir, rec.audioUrl.split('/').pop()!)).catch(() => {});
    await this.segs.delete({ recordingId: rec.id });
    await this.recs.delete(rec.id);
  }
}
