import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChamberStatusDto {
  @ApiProperty({ description: 'false suspende a câmara; true reativa' })
  @IsBoolean()
  active: boolean;

  @ApiPropertyOptional({ example: 'Falta de pagamento' })
  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}
