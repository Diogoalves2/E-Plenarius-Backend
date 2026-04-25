import {
  Controller, Post, Get, Patch, Delete,
  Param, Body, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RegimentoService } from './regimento.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('regimento')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('regimento')
export class RegimentoController {
  constructor(private readonly service: RegimentoService) {}

  @Post('chamber/:chamberId')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Cadastrar/substituir regimento interno' })
  create(
    @Param('chamberId') chamberId: string,
    @Body() dto: { title: string; description?: string; fileUrl: string; fileSize?: number; version?: string },
    @CurrentUser() user: any,
  ) {
    return this.service.create(chamberId, dto, user.id);
  }

  @Get('chamber/:chamberId')
  @Public()
  @ApiOperation({ summary: 'Buscar regimento ativo da câmara' })
  findActive(@Param('chamberId') chamberId: string) {
    return this.service.findActive(chamberId);
  }

  @Get('chamber/:chamberId/all')
  @ApiOperation({ summary: 'Listar todas as versões do regimento' })
  findAll(@Param('chamberId') chamberId: string) {
    return this.service.findAll(chamberId);
  }

  @Patch(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Ativar versão específica do regimento' })
  activate(@Param('id') id: string, @Body('chamberId') chamberId: string) {
    return this.service.activate(id, chamberId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Excluir versão do regimento' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
