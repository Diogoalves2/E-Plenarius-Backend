import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';

export interface TranscriptionResult {
  text: string;
  /** 0..1 quando o modelo informa (whisper-1); null quando não informa. */
  confidence: number | null;
}

export interface TranscriptionContext {
  /** Nomes de vereadores, cidade, termos regimentais — melhora nomes próprios e siglas. */
  keywords: string[];
  prompt: string;
}

/** Frases que modelos de transcrição "inventam" em trechos sem fala. */
const HALLUCINATIONS = /amara\.org|legendas pela comunidade|obrigad[oa] por assistir|inscreva-se no canal|legendado por/i;

/**
 * Transcrição pt-BR. TRANSCRIPTION_PROVIDER=openai (padrão) | fake (testes do CI, sem custo).
 * TRANSCRIPTION_MODEL: gpt-transcribe (padrão, mais preciso, aceita keywords) | whisper-1 (devolve confiança).
 */
@Injectable()
export class TranscriptionProvider {
  private readonly logger = new Logger(TranscriptionProvider.name);

  constructor(private readonly config: ConfigService) {}

  get provider(): string {
    return this.config.get('TRANSCRIPTION_PROVIDER', 'openai');
  }

  get model(): string {
    return this.provider === 'fake' ? 'fake' : this.config.get('TRANSCRIPTION_MODEL', 'gpt-transcribe');
  }

  /** Mensagem de erro se não estiver configurado; null se pronto. */
  configError(): string | null {
    if (this.provider === 'fake') return null;
    if (this.provider !== 'openai') return `Provedor de transcrição desconhecido: ${this.provider}`;
    if (!this.config.get('OPENAI_API_KEY')) return 'Transcrição não configurada: falta a chave OPENAI_API_KEY no servidor.';
    return null;
  }

  async transcribe(file: string, ctx: TranscriptionContext, index: number): Promise<TranscriptionResult> {
    if (this.provider === 'fake') {
      return { text: `Trecho de teste ${index + 1} da Câmara.`, confidence: index % 2 ? 0.9 : 0.4 };
    }

    const audio = await readFile(file);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'trecho.mp3');
    form.append('model', this.model);

    if (this.model === 'whisper-1') {
      form.append('language', 'pt');
      form.append('response_format', 'verbose_json');
      // whisper-1: vocabulário vai no prompt (limite ~224 tokens)
      form.append('prompt', `${ctx.prompt} ${ctx.keywords.join(', ')}`.slice(0, 800));
    } else {
      form.append('languages[]', 'pt');
      form.append('prompt', ctx.prompt.slice(0, 800));
      for (const k of ctx.keywords) form.append('keywords[]', k);
    }

    let lastErr: any;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.config.get('OPENAI_API_KEY')}` },
          body: form,
          signal: AbortSignal.timeout(120_000),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        const body: any = await res.json();
        if (!res.ok) throw Object.assign(new Error(body?.error?.message ?? `HTTP ${res.status}`), { fatal: true });

        let text: string = (body.text ?? '').trim();
        if (HALLUCINATIONS.test(text)) text = '';
        let confidence: number | null = null;
        if (Array.isArray(body.segments) && body.segments.length) {
          const avg = body.segments.reduce((a: number, s: any) => a + (s.avg_logprob ?? 0), 0) / body.segments.length;
          confidence = Math.max(0, Math.min(1, Math.exp(avg)));
        }
        return { text, confidence };
      } catch (err: any) {
        lastErr = err;
        if (err?.fatal) break;
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1) ** 2));
      }
    }
    this.logger.error(`falha na transcrição do trecho ${index}: ${lastErr?.message}`);
    throw lastErr;
  }
}

/** Palavras-chave seguras para a API (sem < > e quebras de linha; até 50 caracteres). */
export function sanitizeKeywords(words: string[], max = 100): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const k = (w ?? '').replace(/[<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
    if (k.length < 2 || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
}
