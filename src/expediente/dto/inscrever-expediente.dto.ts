import { IsIn } from 'class-validator';

export class InscreverExpedienteDto {
  @IsIn(['grande', 'pequeno'])
  tipo: 'grande' | 'pequeno';
}
