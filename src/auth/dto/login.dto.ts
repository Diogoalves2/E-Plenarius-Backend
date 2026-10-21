import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'pedro' })
  @IsString()
  @MinLength(1)
  identifier: string;

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ description: '"Confiar neste computador" (dispensa o código da 2FA por 30 dias)' })
  @IsOptional() @IsString() @MaxLength(2000)
  trustToken?: string;
}

export class MfaTokenDto {
  @ApiProperty({ description: 'Token devolvido pelo login quando falta o segundo fator' })
  @IsString() @MaxLength(2000)
  mfaToken: string;
}

export class MfaCodeDto extends MfaTokenDto {
  @ApiProperty({ example: '123456', description: 'Código do app autenticador ou de recuperação (xxxx-xxxx)' })
  @IsString() @Matches(/^\s*(\d{6}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})\s*$/, { message: 'Código inválido' })
  code: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  remember?: boolean;
}

export class MfaOnlyCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString() @Matches(/^\s*(\d{6}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})\s*$/, { message: 'Código inválido' })
  code: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Encerra só esta sessão; sem ele, encerra todas' })
  @IsOptional() @IsString() @MaxLength(200)
  refreshToken?: string;
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
