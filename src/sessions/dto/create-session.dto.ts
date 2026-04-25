import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { SessionType } from '../entities/session.entity';

export class CreateSessionDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  chamberId: string;

  @ApiProperty({ example: 47 })
  @IsInt()
  @Min(1)
  number: number;

  @ApiProperty({ enum: ['ordinaria', 'extraordinaria', 'solene', 'especial'], default: 'ordinaria' })
  @IsEnum(['ordinaria', 'extraordinaria', 'solene', 'especial'])
  type: SessionType;

  @ApiProperty({ example: '2026-04-17' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ example: '2026-04-17T22:30:00Z' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
