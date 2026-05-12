import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

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
  @IsString()
  userId: string;

  @ApiProperty({ example: '1234', description: 'PIN de 4 dígitos' })
  @IsString()
  @MinLength(4)
  pin: string;
}
