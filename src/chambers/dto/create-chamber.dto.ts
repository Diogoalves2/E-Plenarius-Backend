import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, Length, Matches } from 'class-validator';

export class CreateChamberDto {
  @ApiProperty({ example: 'Câmara Municipal de Vila Aurora' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'camara-vila-aurora' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug deve conter apenas letras minúsculas, números e hífens' })
  slug: string;

  @ApiProperty({ example: 'Vila Aurora' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'MG' })
  @IsString()
  @Length(2, 2)
  state: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logoUrl?: string;
}
