import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';

import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

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
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get('chamber/:chamberId')
  @Public()
  @ApiOperation({ summary: 'Listar vereadores da câmara' })
  findByChamber(@Param('chamberId') chamberId: string) {
    return this.usersService.findByChamber(chamberId);
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
  update(@Param('id') id: string, @Body() body: any) {
    return this.usersService.update(id, body);
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Alterar senha do usuário autenticado' })
  changePassword(
    @CurrentUser() user: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.usersService.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  @Patch(':id/reset-password')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Presidente redefine senha de um vereador (sem exigir senha atual)' })
  adminResetPassword(
    @Param('id') id: string,
    @Body() body: { newPassword: string },
  ) {
    return this.usersService.adminResetPassword(id, body.newPassword);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar vereador por ID' })
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}
