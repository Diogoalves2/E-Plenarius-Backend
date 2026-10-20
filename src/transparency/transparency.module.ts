import { Module } from '@nestjs/common';
import { TransparencyService } from './transparency.service';
import { TransparencyController } from './transparency.controller';
import { VotingModule } from '../voting/voting.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [VotingModule, AuditModule],
  providers: [TransparencyService],
  controllers: [TransparencyController],
})
export class TransparencyModule {}
