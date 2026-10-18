import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgendaItem } from './entities/agenda-item.entity';
import { AgendaService } from './agenda.service';
import { AgendaController } from './agenda.controller';
import { ChambersModule } from '../chambers/chambers.module';

@Module({
  imports: [TypeOrmModule.forFeature([AgendaItem]), ChambersModule],
  providers: [AgendaService],
  controllers: [AgendaController],
  exports: [AgendaService],
})
export class AgendaModule {}
