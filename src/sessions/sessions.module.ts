import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './entities/session.entity';
import { SessionPresence } from './entities/session-presence.entity';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { VotingModule } from '../voting/voting.module';
import { AuditModule } from '../audit/audit.module';
import { ChambersModule } from '../chambers/chambers.module';
import { AtaService } from './ata.service';

@Module({
  imports: [TypeOrmModule.forFeature([Session, SessionPresence]), VotingModule, AuditModule, ChambersModule],
  providers: [SessionsService, AtaService],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
