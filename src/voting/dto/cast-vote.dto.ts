import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { VoteChoice } from '../entities/vote.entity';

export class CastVoteDto {
  @ApiProperty({ example: 'uuid-do-agenda-item' })
  @IsUUID()
  agendaItemId: string;

  @ApiProperty({ enum: ['sim', 'nao', 'abstencao'] })
  @IsEnum(['sim', 'nao', 'abstencao'])
  choice: VoteChoice;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceInfo?: string;
}
