import { Controller, Get, Post, Patch, Body, Param, UseGuards, BadRequestException, ForbiddenException, ParseUUIDPipe, Ip } from '@nestjs/common';

import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto, AdminResetPasswordDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { toPublicUser } from '../common/serialize';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Cadastrar vereador (presidente da câmara ou superadmin)' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: any, @Ip() ip: string) {
    if (actor.role !== 'superadmin' && dto.chamberId !== actor.chamberId) {
      throw new ForbiddenException('Só é possível cadastrar membros da sua câmara');
    }
    return this.usersService.create(dto, { id: actor.id, ip });
  }

  @Get('chamber/:chamberId')
  @Public()
  @ApiOperation({ summary: 'Listar vereadores da câmara' })
  async findByChamber(@Param('chamberId', ParseUUIDPipe) chamberId: string, @CurrentUser() user: any) {
    const users = await this.usersService.findByChamber(chamberId);
    // E-mail, usuário, último acesso e 2FA: só quem gerencia os membros da câmara.
    const canSeePrivate = user && (user.role === 'superadmin'
      || (user.chamberId === chamberId && ['presidente', 'secretaria'].includes(user.role)));
    if (canSeePrivate) return users;
    // Visitante (telão/público) e demais membros: só campos públicos.
    return users.map(u => ({ ...toPublicUser(u), isActive: u.isActive }));
  }

  @Get('me')
  @ApiOperation({ summary: 'Retorna usuário autenticado' })
  me(@CurrentUser() user: any) {
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Atualizar perfil próprio (nome de usuário)' })
  updateMe(
    @CurrentUser() user: any,
    @Body() body: { username?: string },
  ) {
    return this.usersService.updateMe(user.id, body);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Editar dados de um usuário' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateUserDto, @CurrentUser() actor: any, @Ip() ip: string) {
    await this.usersService.assertCanManage(actor, id);
    return this.usersService.updateProfile(id, body, { id: actor.id, ip });
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Alterar senha do usuário autenticado' })
  changePassword(
    @CurrentUser() user: any,
    @Body() body: ChangePasswordDto,
    @Ip() ip: string,
  ) {
    return this.usersService.changePassword(user.id, body.currentPassword, body.newPassword, ip);
  }

  @Patch(':id/reset-password')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Presidente redefine senha de um vereador (sem exigir senha atual)' })
  async adminResetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminResetPasswordDto,
    @CurrentUser() actor: any,
    @Ip() ip: string,
  ) {
    await this.usersService.assertCanManage(actor, id);
    return this.usersService.adminResetPassword(id, body.newPassword, { id: actor.id, ip });
  }

  @Patch(':id/audio-channel')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Definir canal de áudio do vereador na mesa de som (1-24)' })
  async setAudioChannel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { channel: number | null },
    @CurrentUser() actor: any,
  ) {
    await this.usersService.assertCanManage(actor, id);
    if (body.channel !== null) {
      const ch = Number(body.channel);
      if (!Number.isInteger(ch) || ch < 1 || ch > 32) {
        throw new BadRequestException('Canal deve ser inteiro entre 1 e 32');
      }
      await this.usersService.setAudioChannel(id, ch);
      return { ok: true, channel: ch };
    }
    await this.usersService.setAudioChannel(id, null);
    return { ok: true, channel: null };
  }

  @Patch(':id/pin')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Definir/alterar PIN do app mobile (6 dígitos) de um vereador' })
  async setPin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { pin: string | null },
    @CurrentUser() actor: any,
    @Ip() ip: string,
  ) {
    await this.usersService.assertCanManage(actor, id);
    if (body.pin !== null && !/^\d{6}$/.test(String(body.pin))) {
      throw new BadRequestException('PIN deve ter exatamente 6 dígitos numéricos');
    }
    if (body.pin !== null && /^(\d)\1{5}$|^(012345|123456|234567|345678|456789|987654|876543|765432|654321|543210)$/.test(body.pin)) {
      throw new BadRequestException('PIN muito fácil (sequência ou dígitos repetidos). Escolha outro.');
    }
    await this.usersService.setPin(id, body.pin, { id: actor.id, ip });
    return { ok: true, hasPin: body.pin !== null };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar vereador por ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: any) {
    const user = await this.usersService.findById(id);
    if (actor.role !== 'superadmin' && actor.id !== id && user.chamberId !== actor.chamberId) {
      throw new ForbiddenException('Sem acesso a usuários de outra câmara');
    }
    const manager = actor.role === 'superadmin' || ['presidente', 'secretaria'].includes(actor.role);
    return actor.id === id || manager ? user : { ...toPublicUser(user), isActive: user.isActive };
  }
}
