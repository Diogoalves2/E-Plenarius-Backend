import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../../sessions/entities/session.entity';
import { AgendaItem } from '../../agenda/entities/agenda-item.entity';
import { ChamberAccessService } from './chamber-access.service';
import { SessionChamberGuard } from './session-chamber.guard';
import { LoginAttemptsService } from './login-attempts.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Session, AgendaItem])],
  providers: [ChamberAccessService, SessionChamberGuard, LoginAttemptsService],
  exports: [ChamberAccessService, SessionChamberGuard, LoginAttemptsService],
})
export class AccessModule {}
