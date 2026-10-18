import {
  Controller, Post, Get, Patch, Delete,
  Param, Body, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { RegimentoService } from './regimento.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ChamberAccessService } from '../common/access/chamber-access.service';

export class CreateRegimentoDto {
  @ApiProperty() @IsString() @MaxLength(300)
  title: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  description?: string;

  @ApiProperty({ example: '/uploads/doc_abc.pdf' })
  @IsString()
  @Matches(/^(\/uploads\/[\w.-]+|https:\/\/\S+)$/, { message: 'fileUrl deve ser um upload (/uploads/...) ou URL https' })
  fileUrl: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  fileSize?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  version?: string;
}

@ApiTags('regimento')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('regimento')
export class RegimentoController {
  constructor(
    private readonly service: RegimentoService,
    private readonly access: ChamberAccessService,
  ) {}

  @Post('chamber/:chamberId')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Cadastrar/substituir regimento interno' })
  create(
    @Param('chamberId', ParseUUIDPipe) chamberId: string,
    @Body() dto: CreateRegimentoDto,
    @CurrentUser() user: any,
  ) {
    this.access.assertChamber(user, chamberId);
    return this.service.create(chamberId, dto, user.id);
  }

  @Get('chamber/:chamberId')
  @Public()
  @ApiOperation({ summary: 'Buscar regimento ativo da câmara' })
  findActive(@Param('chamberId', ParseUUIDPipe) chamberId: string) {
    return this.service.findActive(chamberId);
  }

  @Get('chamber/:chamberId/all')
  @ApiOperation({ summary: 'Listar todas as versões do regimento' })
  findAll(@Param('chamberId', ParseUUIDPipe) chamberId: string, @CurrentUser() user: any) {
    this.access.assertChamber(user, chamberId);
    return this.service.findAll(chamberId);
  }

  @Patch(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Ativar versão específica do regimento' })
  async activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const reg = await this.service.findById(id);
    this.access.assertChamber(user, reg.chamberId);
    return this.service.activate(id, reg.chamberId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Excluir versão do regimento' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const reg = await this.service.findById(id);
    this.access.assertChamber(user, reg.chamberId);
    return this.service.remove(id);
  }
}
