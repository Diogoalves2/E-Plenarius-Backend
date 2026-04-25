import { IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class AjustarTempoDto {
  @Type(() => Number)
  @IsIn([1, -1])
  delta: 1 | -1;
}
