import { spawn } from 'child_process';

/** Executa ffmpeg/ffprobe e devolve stdout+stderr. Rejeita se o processo sair com erro. */
function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d; if (stdout.length > 5e6) stdout = stdout.slice(-1e6); });
    p.stderr.on('data', d => { stderr += d; if (stderr.length > 5e6) stderr = stderr.slice(-2e6); });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} saiu com código ${code}: ${stderr.slice(-400)}`)));
  });
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(stdout.trim());
  if (!isFinite(d) || d <= 0) throw new Error('Não foi possível ler a duração do áudio');
  return d;
}

/** Áudio de trabalho: mono, 16 kHz, MP3 48 kbps — leve para o player e bom para transcrição. */
export async function normalizeAudio(input: string, output: string): Promise<void> {
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', input,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', output]);
}

/** Intervalos de silêncio (segundos). */
export async function detectSilences(file: string, noiseDb = -35, minSilence = 0.6): Promise<{ start: number; end: number }[]> {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file,
    '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`, '-f', 'null', '-']);
  const out: { start: number; end: number }[] = [];
  let open: number | null = null;
  for (const line of stderr.split('\n')) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) { open = Math.max(0, parseFloat(s[1])); continue; }
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && open != null) { out.push({ start: open, end: parseFloat(e[1]) }); open = null; }
  }
  return out;
}

export interface Chunk { start: number; end: number }

/**
 * Corta o áudio em trechos de fala: corta no meio das pausas quando o trecho já tem `minLen`
 * segundos; força o corte em `maxLen` se não houver pausa. Trechos quase sem fala são descartados
 * (evita "alucinação" do modelo em silêncio).
 */
export function planChunks(duration: number, silences: { start: number; end: number }[], minLen = 8, maxLen = 40): Chunk[] {
  const cuts: number[] = [];
  let last = 0;
  for (const s of silences) {
    const mid = (s.start + s.end) / 2;
    while (mid - last > maxLen) { last += maxLen; cuts.push(last); }
    if (mid - last >= minLen) { cuts.push(mid); last = mid; }
  }
  while (duration - last > maxLen) { last += maxLen; cuts.push(last); }

  const bounds = [0, ...cuts, duration];
  const chunks: Chunk[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const c = { start: bounds[i], end: bounds[i + 1] };
    const silent = silences.reduce((acc, s) => acc + Math.max(0, Math.min(s.end, c.end) - Math.max(s.start, c.start)), 0);
    if (c.end - c.start - silent >= 1) chunks.push(c);
  }
  return chunks;
}

export async function extractChunk(input: string, c: Chunk, output: string): Promise<void> {
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', c.start.toFixed(3), '-to', c.end.toFixed(3),
    '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', output]);
}
