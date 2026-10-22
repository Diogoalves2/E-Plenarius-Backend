import { Controller, Get, Post, Patch, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ChambersService } from './chambers.service';
import { CreateChamberDto } from './dto/create-chamber.dto';
import { SetupChamberDto } from './dto/setup-chamber.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChamberAccessService } from '../common/access/chamber-access.service';
import { AuditService } from '../audit/audit.service';
import { ChamberSettingsDto } from './dto/chamber-settings.dto';

@ApiTags('chambers')
@Controller('chambers')
export class ChambersController {
  constructor(
    private readonly chambersService: ChambersService,
    private readonly access: ChamberAccessService,
    private readonly audit: AuditService,
  ) {}

  @Post('setup')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @ApiOperation({ summary: 'Criar câmara + presidente em uma operação (superadmin)' })
  setup(@Body() dto: SetupChamberDto) {
    return this.chambersService.setup(dto);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @ApiOperation({ summary: 'Cadastrar nova câmara (superadmin)' })
  create(@Body() dto: CreateChamberDto) {
    return this.chambersService.create(dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @ApiOperation({ summary: 'Listar câmaras (superadmin)' })
  findAll() {
    return this.chambersService.findAll();
  }

  @Get('by-slug/:slug')
  @ApiOperation({ summary: 'Buscar câmara pelo slug (público, usado pelo app mobile)' })
  findBySlugPublic(@Param('slug') slug: string) {
    return this.chambersService.findBySlugPublic(slug);
  }

  @Get('by-slug/:slug/vereadores')
  @ApiOperation({ summary: 'Listar vereadores da câmara pelo slug (público, para tela de login do app)' })
  vereadoresBySlug(@Param('slug') slug: string) {
    return this.chambersService.listVereadoresBySlug(slug);
  }

  @Get(':id/settings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Regras regimentais da câmara (maiorias, quórum, presidente, roteiro)' })
  getSettings(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    this.access.assertChamber(user, id);
    return this.chambersService.getRules(id);
  }

  @Patch(':id/settings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'superadmin')
  @ApiOperation({ summary: 'Configurar regras regimentais (presidente)' })
  async updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChamberSettingsDto,
    @CurrentUser() user: any,
  ) {
    this.access.assertChamber(user, id);
    const rules = await this.chambersService.updateSettings(id, dto);
    await this.audit.log({ chamberId: id, userId: user.id, action: 'chamber:settings', detail: { ...dto } });
    return rules;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar câmara por ID (público: nome, logo, regras do regimento)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.chambersService.findOne(id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @ApiOperation({ summary: 'Editar câmara (superadmin)' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.chambersService.update(id, body);
  }

  @Patch(':id/reset-credentials')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  @ApiOperation({ summary: 'Redefinir senha do presidente da câmara (superadmin)' })
  resetCredentials(@Param('id') id: string) {
    return this.chambersService.resetPresidentePassword(id);
  }
}
