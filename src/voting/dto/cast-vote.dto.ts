import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
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
  @MaxLength(200)
  deviceInfo?: string;

  @ApiPropertyOptional({ description: 'PIN do vereador (quando a câmara exige confirmação do voto)' })
  @IsOptional()
  @Matches(/^\d{4,6}$/, { message: 'PIN inválido' })
  pin?: string;
}
