import { Controller, Post, Get, Body, Param, ParseUUIDPipe, UseGuards, HttpCode, HttpStatus, Ip } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, MobileLoginDto, MfaTokenDto, MfaCodeDto, MfaOnlyCodeDto, LogoutDto } from './dto/login.dto';
import { MfaService } from './mfa/mfa.service';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Post('login')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login com e-mail e senha' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('mobile-login')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login do app mobile: userId + PIN de 4 dígitos' })
  mobileLogin(@Body() dto: MobileLoginDto) {
    return this.authService.mobileLogin(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar access token com refresh token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Logout — revoga o refresh token informado (ou todos)' })
  logout(@CurrentUser() user: any, @Body() dto: LogoutDto) {
    return this.authService.logout(user.id, dto?.refreshToken);
  }

  // ── Verificação em duas etapas (superadmin/presidente no painel web) ──

  @Post('mfa/setup')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '2FA: gera o segredo/QR code (primeiro acesso)' })
  mfaSetup(@Body() dto: MfaTokenDto) {
    return this.authService.mfaSetup(dto.mfaToken);
  }

  @Post('mfa/enable')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '2FA: confirma o primeiro código, ativa e conclui o login' })
  mfaEnable(@Body() dto: MfaCodeDto, @Ip() ip: string) {
    return this.authService.mfaEnable(dto.mfaToken, dto.code, !!dto.remember, ip);
  }

  @Post('mfa/verify')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '2FA: código do app (ou de recuperação) e conclui o login' })
  mfaVerify(@Body() dto: MfaCodeDto, @Ip() ip: string) {
    return this.authService.mfaVerify(dto.mfaToken, dto.code, !!dto.remember, ip);
  }

  @Get('mfa/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '2FA: situação do usuário autenticado' })
  mfaStatus(@CurrentUser() user: any) {
    return this.mfa.status(user.id);
  }

  @Post('mfa/recovery-codes')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '2FA: gera novos códigos de recuperação (exige código atual)' })
  mfaRecovery(@CurrentUser() user: any, @Body() dto: MfaOnlyCodeDto, @Ip() ip: string) {
    return this.mfa.regenerateRecovery(user.id, dto.code, ip);
  }

  @Post('mfa/reset/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @ApiOperation({ summary: '2FA: superadmin redefine (celular perdido); o usuário cadastra de novo no próximo login' })
  mfaReset(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() actor: any, @Ip() ip: string) {
    return this.mfa.reset(userId, actor.id, ip);
  }
}
