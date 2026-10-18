import { Module } from '@nestjs/common';
import { TransparencyService } from './transparency.service';
import { TransparencyController } from './transparency.controller';
import { VotingModule } from '../voting/voting.module';

@Module({
  imports: [VotingModule],
  providers: [TransparencyService],
  controllers: [TransparencyController],
})
export class TransparencyModule {}
