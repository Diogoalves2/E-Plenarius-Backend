import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        database: config.get('DB_NAME', 'eplenarius'),
        username: config.get('DB_USER', 'eplenarius'),
        password: config.get('DB_PASSWORD', 'eplenarius_secret'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
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
  ],
})
export class AppModule {}
