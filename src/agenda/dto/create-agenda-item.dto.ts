import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { VotingType } from '../entities/agenda-item.entity';

export class CreateAgendaItemDto {
  @ApiProperty({ example: 'uuid-da-sessao' })
  @IsUUID()
  sessionId: string;

  @ApiProperty({ example: 'uuid-da-camara' })
  @IsUUID()
  chamberId: string;

  @ApiProperty({ example: 'PL 023/2026' })
  @IsString()
  number: string;

  @ApiProperty({ example: 'Projeto de Lei' })
  @IsString()
  type: string;

  @ApiProperty({ example: 'Institui o Programa Municipal de Hortas Comunitárias' })
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'URL do PDF do projeto' })
  @IsOptional()
  @IsString()
  pdfUrl?: string;

  @ApiProperty({ example: 'Beatriz Monteiro (PSB)' })
  @IsString()
  authorName: string;

  @ApiPropertyOptional({ description: 'UUID do vereador autor (se cadastrado)' })
  @IsOptional()
  @IsUUID()
  authorUserId?: string;

  @ApiProperty({ enum: ['aberta', 'secreta'], default: 'aberta' })
  @IsEnum(['aberta', 'secreta'])
  votingType: VotingType;

  @ApiProperty({ default: 5 })
  @IsInt()
  @Min(1)
  quorumMinimum: number;

  @ApiProperty({ default: 0 })
  @IsInt()
  @Min(0)
  orderIndex: number;
}
