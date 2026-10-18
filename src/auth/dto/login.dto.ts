import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'pedro' })
  @IsString()
  @MinLength(1)
  identifier: string;

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class MobileLoginDto {
  @ApiProperty({ example: 'uuid-do-vereador' })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: '123456', description: 'PIN numérico (6 dígitos; 4 aceito por compatibilidade)' })
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN inválido' })
  pin: string;

  @ApiProperty({ description: 'Chave secreta gerada pelo tablet na primeira execução' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32,128}$/, { message: 'Atualize o aplicativo para continuar' })
  deviceKey: string;

  @ApiPropertyOptional({ example: 'Samsung SM-X200' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;
}
