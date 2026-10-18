import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChamberAccessService } from '../common/access/chamber-access.service';

export class DeviceLabelDto {
  @ApiPropertyOptional({ example: 'Tablet 3 — bancada esquerda', nullable: true })
  @IsOptional() @IsString() @MaxLength(100)
  label?: string | null;
}

@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('presidente', 'superadmin')
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly access: ChamberAccessService,
  ) {}

  private async load(id: string, user: any) {
    const d = await this.devices.findById(id);
    this.access.assertChamber(user, d.chamberId);
    return d;
  }

  @Get('chamber/:chamberId')
  @ApiOperation({ summary: 'Tablets da câmara (pendentes, aprovados, bloqueados)' })
  list(@Param('chamberId', ParseUUIDPipe) chamberId: string, @CurrentUser() user: any) {
    this.access.assertChamber(user, chamberId);
    return this.devices.listByChamber(chamberId);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Autorizar tablet' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeviceLabelDto, @CurrentUser() user: any) {
    await this.load(id, user);
    return this.devices.setStatus(id, 'aprovado', user.id, dto.label ?? undefined);
  }

  @Patch(':id/revoke')
  @ApiOperation({ summary: 'Bloquear tablet (encerra a sessão do app imediatamente)' })
  async revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    await this.load(id, user);
    return this.devices.setStatus(id, 'revogado', user.id);
  }

  @Patch(':id/label')
  @ApiOperation({ summary: 'Renomear tablet' })
  async rename(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeviceLabelDto, @CurrentUser() user: any) {
    await this.load(id, user);
    return this.devices.rename(id, dto.label ?? null);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remover registro do tablet' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    await this.load(id, user);
    await this.devices.remove(id, user.id);
    return { ok: true };
  }
}
