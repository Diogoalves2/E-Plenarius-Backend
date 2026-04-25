import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './entities/session.entity';
import { SessionPresence } from './entities/session-presence.entity';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { VotingModule } from '../voting/voting.module';

@Module({
  imports: [TypeOrmModule.forFeature([Session, SessionPresence]), VotingModule],
  providers: [SessionsService],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
