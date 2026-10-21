import type sharpEsm from 'sharp';
// sharp 0.35: em CommonJS o módulo É a função (sem .default); os tipos resolvidos são os do ESM.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp: typeof sharpEsm = require('sharp');
import { rename, stat, unlink } from 'fs/promises';
import { extname } from 'path';

sharp.cache(false);

/** Maior lado, em pixels, de cada uso. Foto de vereador aparece no máximo em ~300 px. */
export const IMAGE_MAX_SIDE = { avatar: 640, thumb: 1600, logo: 1000 } as const;
export type ImageKind = keyof typeof IMAGE_MAX_SIDE;

// Imagem "bomba" (dimensões gigantes para estourar a memória) é recusada antes de decodificar.
const LIMIT_INPUT_PIXELS = 40_000_000;

/**
 * Reduz e recomprime a imagem no próprio arquivo de upload. Também remove os metadados
 * (EXIF: localização GPS, modelo do celular, data) que a foto do celular carrega.
 *
 * - Foto/capa → JPEG; logo → mantém PNG (transparência) ou JPEG.
 * - `keepFormat`: mantém o formato e o nome do arquivo (usado para converter arquivos já
 *   referenciados no banco) e só substitui se o resultado ficar menor.
 *
 * Retorna o caminho final (a extensão pode mudar para .jpg).
 */
export async function optimizeImage(
  path: string,
  kind: ImageKind,
  { keepFormat = false }: { keepFormat?: boolean } = {},
): Promise<{ path: string; before: number; after: number }> {
  const before = (await stat(path)).size;
  const input = () => sharp(path, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'error' });
  const meta = await input().metadata();

  const ext = extname(path).toLowerCase();
  const asPng = keepFormat
    ? ext === '.png'
    : kind === 'logo' && (meta.format === 'png' || meta.format === 'webp' || !!meta.hasAlpha);
  const outPath = keepFormat ? path : path.slice(0, path.length - ext.length) + (asPng ? '.png' : '.jpg');
  const tmp = `${outPath}.tmp`;

  const max = IMAGE_MAX_SIDE[kind];
  let pipeline = input()
    .rotate() // aplica a orientação do EXIF antes de descartá-lo
    .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
  pipeline = asPng
    ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
    : pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true });
  await pipeline.toFile(tmp);

  const after = (await stat(tmp)).size;
  if (keepFormat && after >= before) {
    await unlink(tmp);
    return { path, before, after: before };
  }
  await rename(tmp, outPath);
  if (outPath !== path) await unlink(path).catch(() => {});
  return { path: outPath, before, after };
}
