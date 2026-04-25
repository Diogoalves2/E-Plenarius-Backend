import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegimentoInterno } from './entities/regimento.entity';
import { RegimentoService } from './regimento.service';
import { RegimentoController } from './regimento.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RegimentoInterno])],
  providers: [RegimentoService],
  controllers: [RegimentoController],
})
export class RegimentoModule {}
