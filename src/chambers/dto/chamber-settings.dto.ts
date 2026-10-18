import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { Majority, PresidentVoteRule } from '../../common/legislative';

export class SessionPhaseDto {
  @IsString() @Matches(/^[a-z0-9_]{2,40}$/, { message: 'chave da fase: letras minúsculas, números e _' })
  key: string;

  @IsString() @MaxLength(80)
  label: string;
}

export class ChamberSettingsDto {
  @ApiPropertyOptional({ nullable: true, description: 'Cadeiras da Casa (null = conta membros ativos)' })
  @IsOptional() @IsInt() @Min(3) @Max(99)
  totalSeats?: number | null;

  @ApiPropertyOptional({ enum: ['always', 'tie_only', 'tie_and_qualified'] })
  @IsOptional() @IsIn(['always', 'tie_only', 'tie_and_qualified'])
  presidentVoteRule?: PresidentVoteRule;

  @ApiPropertyOptional({ example: { 'Emenda à Lei Orgânica': 'dois_tercos' } })
  @IsOptional() @IsObject()
  majorityByType?: Record<string, Majority> | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsInt() @Min(1) @Max(99)
  defaultQuorum?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  requirePinToVote?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  autoOpenMic?: boolean;

  @ApiPropertyOptional({ type: [SessionPhaseDto], nullable: true })
  @IsOptional() @IsArray() @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => SessionPhaseDto)
  sessionPhases?: SessionPhaseDto[] | null;
}
