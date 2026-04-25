import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, Length, IsOptional, MinLength } from 'class-validator';

export class SetupChamberDto {
  @ApiProperty({ example: 'Câmara Municipal de Vila Aurora' })
  @IsString()
  name: string;

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

  @ApiProperty({ example: 'João da Silva' })
  @IsString()
  presidenteName: string;

  @ApiProperty({ example: 'presidente@vilaaurora.leg.br' })
  @IsEmail()
  presidenteEmail: string;

  @ApiPropertyOptional({ example: 'senha123', description: 'Se omitida, uma senha aleatória será gerada' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  presidentePassword?: string;

  @ApiPropertyOptional({ example: 'MDB' })
  @IsOptional()
  @IsString()
  presidenteParty?: string;
}
