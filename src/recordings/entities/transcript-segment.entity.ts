import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Trecho da degravação: texto da máquina + correção humana. */
@Entity('transcript_segments')
@Index(['recordingId', 'idx'])
export class TranscriptSegment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  recordingId: string;

  @Column({ type: 'int' })
  idx: number;

  @Column({ type: 'float' })
  startSec: number;

  @Column({ type: 'float' })
  endSec: number;

  /** Orador sugerido pela linha do tempo do expediente (editável). */
  @Column({ type: 'varchar', nullable: true })
  speaker: string | null;

  /** Texto original da transcrição automática (nunca é alterado). */
  @Column({ type: 'text' })
  text: string;

  /** Texto corrigido pelo revisor (null = sem correção). */
  @Column({ type: 'text', nullable: true })
  editedText: string | null;

  @Column({ type: 'float', nullable: true })
  confidence: number | null;

  /** Precisa de conferência: baixa confiança ou contém números (projetos, leis, valores). */
  @Column({ default: false })
  needsReview: boolean;

  @Column({ default: false })
  reviewed: boolean;
}
