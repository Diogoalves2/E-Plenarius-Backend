import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '../entities/user.entity';

/** Campos editáveis via PATCH /users/:id. Qualquer outro campo é rejeitado pelo ValidationPipe. */
export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString()
  username?: string | null;

  @ApiPropertyOptional({ enum: ['presidente', 'vice_presidente', 'vereador', 'secretaria'] })
  @IsOptional() @IsIn(['presidente', 'vice_presidente', 'vereador', 'secretaria'])
  role?: UserRole;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString()
  title?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString()
  party?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4)
  initials?: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString()
  avatarUrl?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString()
  currentPassword: string;

  @ApiProperty({ minLength: 6 }) @IsString() @MinLength(6)
  newPassword: string;
}

export class AdminResetPasswordDto {
  @ApiProperty({ minLength: 6 }) @IsString() @MinLength(6)
  newPassword: string;
}
