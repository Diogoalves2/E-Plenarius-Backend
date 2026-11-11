import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Dados da transmissão exibidos no telão e no painel. Vazio ('') limpa o campo.
 * Só link https do YouTube: o telão é público e não pode exibir endereço qualquer.
 */
export class UpdateStreamDto {
  @ApiPropertyOptional({ example: 'https://www.youtube.com/@camaradeemas/live' })
  @IsOptional() @IsString() @MaxLength(300)
  @Matches(/^$|^https:\/\/(www\.|m\.)?(youtube\.com\/((watch\?v=|live\/|embed\/)[\w-]{6,}|@[\w.-]{2,}(\/(live|streams))?)|youtu\.be\/[\w-]{6,})[\w?=&%.-]*$/, {
    message: 'Informe um link do YouTube (https://youtube.com/... ou https://youtu.be/...).',
  })
  youtubeUrl?: string;

  @ApiPropertyOptional({ example: '/uploads/avatar_abc.jpg' })
  @IsOptional() @IsString() @MaxLength(300)
  @Matches(/^$|^\/uploads\/[\w.-]+\.(jpe?g|png|webp)$|^https:\/\/i(mg)?\.ytimg\.com\/|^https:\/\/img\.youtube\.com\//, {
    message: 'Capa inválida: envie uma imagem pelo painel.',
  })
  youtubeThumbnailUrl?: string;
}
