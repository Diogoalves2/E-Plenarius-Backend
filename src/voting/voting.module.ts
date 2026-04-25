import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Vote } from './entities/vote.entity';
import { User } from '../users/entities/user.entity';
import { VotingService } from './voting.service';
import { VotingController } from './voting.controller';
import { VotingGateway } from './voting.gateway';
import { AgendaModule } from '../agenda/agenda.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Vote, User]),
    AgendaModule,
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '15m') },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [VotingService, VotingGateway],
  controllers: [VotingController],
  exports: [VotingService, VotingGateway],
})
export class VotingModule {}
