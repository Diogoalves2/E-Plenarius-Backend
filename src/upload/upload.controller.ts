import {
  Controller,
  Post,
  Get,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { open, unlink } from 'fs/promises';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

const UPLOADS_DIR      = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
const SYSTEM_LOGO_FILE = join(UPLOADS_DIR, 'system_logo.txt');

const MAX_LOGO_BYTES   =  2 * 1024 * 1024; //  2 MB
const MAX_AVATAR_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_PDF_BYTES    = 20 * 1024 * 1024; // 20 MB

/**
 * A extensão salva vem do TIPO validado, nunca do nome enviado — um "foto.html" com tipo de
 * imagem não vira página HTML hospedada no domínio oficial.
 */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

/** Confere os primeiros bytes do arquivo (assinatura real do formato). */
async function assertFileSignature(path: string, mime: string): Promise<void> {
  const fh = await open(path, 'r');
  const head = Buffer.alloc(512);
  try { await fh.read(head, 0, 512, 0); } finally { await fh.close(); }
  const ok =
    mime === 'image/png' ? head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : mime === 'image/jpeg' ? head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    : mime === 'image/webp' ? head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP'
    : mime === 'application/pdf' ? head.toString('ascii', 0, 5) === '%PDF-'
    : mime === 'image/svg+xml' ? /<svg[\s>]/i.test(head.toString('utf8'))
    : false;
  if (!ok) {
    await unlink(path).catch(() => {});
    throw new BadRequestException('O conteúdo do arquivo não corresponde ao formato informado.');
  }
  if (mime === 'image/svg+xml') {
    // SVG pode carregar script: só aceito sem conteúdo ativo (também é servido em sandbox)
    const svg = readFileSync(path, 'utf8');
    if (/<script|<foreignObject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:|data:text\/html/i.test(svg)) {
      await unlink(path).catch(() => {});
      throw new BadRequestException('SVG com conteúdo ativo (script/eventos) não é permitido.');
    }
  }
}

function imageStorage(prefix: string) {
  return diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${prefix}${randomBytes(16).toString('hex')}${EXT_BY_MIME[file.mimetype] ?? '.bin'}`),
  });
}

function mimeFilter(allowed: string[], message: string) {
  return (_req: any, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) => {
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new BadRequestException(message), false);
  };
}

@ApiTags('upload')
@Controller('upload')
export class UploadController {
  @Post('avatar')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'presidente')
  @ApiOperation({ summary: 'Upload de foto de usuário (superadmin/presidente)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: imageStorage('avatar_'),
      limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
      fileFilter: mimeFilter(['image/jpeg', 'image/png', 'image/webp'], 'Formato inválido. Use JPG, PNG ou WebP.'),
    }),
  )
  async uploadAvatar(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    await assertFileSignature(file.path, file.mimetype);
    return { url: `/uploads/${file.filename}` };
  }

  @Post('logo')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @ApiOperation({ summary: 'Upload de logomarca (superadmin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: imageStorage(''),
      limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
      fileFilter: mimeFilter(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'], 'Formato inválido. Use JPG, PNG, WebP ou SVG.'),
    }),
  )
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    await assertFileSignature(file.path, file.mimetype);
    const url = `/uploads/${file.filename}`;
    writeFileSync(SYSTEM_LOGO_FILE, url, 'utf8');
    return { url };
  }

  @Get('system-logo')
  @ApiOperation({ summary: 'Retorna a URL do logo atual do sistema (público)' })
  getSystemLogo() {
    if (!existsSync(SYSTEM_LOGO_FILE)) return { url: null };
    const url = readFileSync(SYSTEM_LOGO_FILE, 'utf8').trim();
    return { url: /^\/uploads\/[\w.-]+$/.test(url) ? url : null };
  }

  @Post('pdf')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'presidente', 'secretaria')
  @ApiOperation({ summary: 'Upload de PDF de projeto (presidente/secretaria)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req, _file, cb) => cb(null, `doc_${randomBytes(16).toString('hex')}.pdf`),
      }),
      limits: { fileSize: MAX_PDF_BYTES, files: 1 },
      fileFilter: mimeFilter(['application/pdf'], 'Apenas arquivos PDF são aceitos.'),
    }),
  )
  async uploadPdf(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    await assertFileSignature(file.path, file.mimetype);
    return { url: `/uploads/${file.filename}` };
  }
}
