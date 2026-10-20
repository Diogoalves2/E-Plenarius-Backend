import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength, Matches } from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class CreateUserDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  chamberId: string;

  @ApiProperty({ example: 'Beatriz Monteiro' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'beatriz@vilaaurora.leg.br' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'beatriz' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'A senha deve ter pelo menos 8 caracteres.' })
  password: string;

  @ApiProperty({ enum: ['presidente', 'vice_presidente', 'vereador', 'secretaria'], default: 'vereador' })
  @IsEnum(['presidente', 'vice_presidente', 'vereador', 'secretaria'])
  role: UserRole;

  @ApiPropertyOptional({ example: 'Vereador' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'PSB' })
  @IsOptional()
  @IsString()
  party?: string;

  @ApiPropertyOptional({ example: 'BM' })
  @IsOptional()
  @IsString()
  initials?: string;

  @ApiPropertyOptional({ example: '/uploads/avatars/abc.jpg' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
