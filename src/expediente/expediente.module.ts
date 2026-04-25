import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InscricaoExpediente } from './entities/inscricao-expediente.entity';
import { ExpedienteService } from './expediente.service';
import { ExpedienteController } from './expediente.controller';
import { VotingModule } from '../voting/voting.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InscricaoExpediente]),
    VotingModule,
  ],
  providers: [ExpedienteService],
  controllers: [ExpedienteController],
})
export class ExpedienteModule {}
