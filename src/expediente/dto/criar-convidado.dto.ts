import { IsIn, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CriarConvidadoDto {
  @IsIn(['grande', 'pequeno'])
  tipo: 'grande' | 'pequeno';

  @IsString()
  nome: string;

  @IsString()
  cargo: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  tempo: number;
}
