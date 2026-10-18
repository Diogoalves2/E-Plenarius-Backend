import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health.controller';
import { AccessModule } from './common/access/access.module';
import { DatabaseIntegrityService } from './common/database-integrity.service';
import { HttpThrottlerGuard } from './common/guards/http-throttler.guard';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChambersModule } from './chambers/chambers.module';
import { SessionsModule } from './sessions/sessions.module';
import { AgendaModule } from './agenda/agenda.module';
import { VotingModule } from './voting/voting.module';
import { AuditModule } from './audit/audit.module';
import { UploadModule } from './upload/upload.module';
import { ExpedienteModule } from './expediente/expediente.module';
import { StatsModule } from './stats/stats.module';
import { RegimentoModule } from './regimento/regimento.module';
import { DevicesModule } from './devices/devices.module';
import { TransparencyModule } from './transparency/transparency.module';
import { RecordingsModule } from './recordings/recordings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Limite global generoso: na câmara todos os tablets saem pelo mesmo IP (NAT).
    // Rotas de login têm limite próprio (@Throttle) + bloqueio por usuário no AuthService.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 600 }]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const isProd = config.get('NODE_ENV') === 'production';
        const entities = [__dirname + '/**/*.entity{.ts,.js}'];

        // Dev local: ignora DATABASE_URL/DB_* (podem apontar pra outro postgres)
        // e usa DEV_DATABASE_URL, default = container eplenarius-pg porta 5434.
        if (!isProd) {
          return {
            type: 'postgres',
            url: config.get(
              'DEV_DATABASE_URL',
              'postgres://eplenarius:eplenarius_secret@127.0.0.1:5434/eplenarius',
            ),
            entities,
            synchronize: true,
            logging: false,
            ssl: false,
          };
        }

        // Prod: DATABASE_URL ou DB_*. DB_SSL=true para Postgres gerenciado
        // (Render/Neon); Postgres local da VPS roda sem SSL.
        const url = config.get('DATABASE_URL');
        return {
          type: 'postgres',
          url,
          host: url ? undefined : config.get('DB_HOST', 'localhost'),
          port: url ? undefined : Number(config.get('DB_PORT', 5432)),
          database: url ? undefined : config.get('DB_NAME', 'eplenarius'),
          username: url ? undefined : config.get('DB_USER', 'eplenarius'),
          password: url ? undefined : config.get('DB_PASSWORD'),
          entities,
          synchronize: config.get('DB_SYNCHRONIZE') === 'true',
          logging: false,
          ssl: config.get('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        };
      },
      inject: [ConfigService],
    }),
    AccessModule,
    AuthModule,
    UsersModule,
    ChambersModule,
    SessionsModule,
    AgendaModule,
    VotingModule,
    AuditModule,
    UploadModule,
    ExpedienteModule,
    StatsModule,
    RegimentoModule,
    DevicesModule,
    TransparencyModule,
    RecordingsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }, DatabaseIntegrityService],
})
export class AppModule {}
