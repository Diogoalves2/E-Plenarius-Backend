import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recording } from './entities/recording.entity';
import { TranscriptSegment } from './entities/transcript-segment.entity';
import { RecordingsService } from './recordings.service';
import { RecordingsController } from './recordings.controller';
import { TranscriptionProvider } from './transcription.provider';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([Recording, TranscriptSegment]), AuditModule],
  providers: [RecordingsService, TranscriptionProvider],
  controllers: [RecordingsController],
})
export class RecordingsModule {}
