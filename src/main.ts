import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger, ExceptionFilter, ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { raw } from 'express';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';

@Catch()
class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalException');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<any>();
    const req = ctx.getRequest<any>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : { statusCode: 500, message: 'Internal server error' };

    if (status >= 500) {
      const err = exception as any;
      this.logger.error(
        `[${req.method}] ${req.url} -> ${status} | ${err?.message ?? exception}`,
        err?.stack ?? String(exception),
      );
    }

    res.status(status).json(message);
  }
}

async function bootstrap() {
  const uploadsDir = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
  mkdirSync(uploadsDir, { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Atrás do Nginx: req.ip passa a ser o IP real do cliente (X-Forwarded-For).
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.disable('x-powered-by');
  app.enableShutdownHooks();

  const frontendOrigins = (process.env.FRONTEND_URL ?? '').split(',').map(o => o.trim()).filter(Boolean);
  app.use((req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!req.path.startsWith('/uploads/')) {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
    next();
  });
  // Partes da gravação da sessão chegam como binário (20 MB cada, abaixo do limite do Nginx).
  app.use('/api/recordings', raw({ type: 'application/octet-stream', limit: '21mb' }));
  app.useStaticAssets(uploadsDir, {
    prefix: '/uploads',
    setHeaders: (res, filePath) => {
      if (filePath.toLowerCase().endsWith('.svg')) {
        // SVG pode carregar script: servido em sandbox, sem execução.
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      } else {
        // PDFs do regimento/pauta são exibidos em iframe no frontend.
        res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${frontendOrigins.join(' ')}`);
      }
    },
  });
  app.useGlobalFilters(new GlobalExceptionFilter());

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const allowedOrigins = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
    : true;

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('E-Plenarius API')
      .setDescription('Sistema de votação para Câmaras Municipais')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || process.env.BACKEND_PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend rodando em http://0.0.0.0:${port} (rede local disponível)`);
  if (swaggerEnabled) console.log(`Swagger em http://localhost:${port}/api/docs`);
}
bootstrap();
