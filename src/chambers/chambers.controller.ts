import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ChambersService } from './chambers.service';
import { CreateChamberDto } from './dto/create-chamber.dto';
import { SetupChamberDto } from './dto/setup-chamber.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('chambers')
@Controller('chambers')
export class ChambersController {
  constructor(private readonly chambersService: ChambersService) {}

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
  @ApiOperation({ summary: 'Listar câmaras' })
  findAll() {
    return this.chambersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar câmara por ID' })
  findOne(@Param('id') id: string) {
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
