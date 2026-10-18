import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../../sessions/entities/session.entity';
import { AgendaItem } from '../../agenda/entities/agenda-item.entity';

export interface AuthUser {
  id: string;
  role: string;
  chamberId: string | null;
}

/**
 * Isolamento multi-câmara: todo acesso autenticado a recurso de uma câmara passa por aqui.
 * Superadmin acessa tudo; demais perfis só a própria câmara.
 */
@Injectable()
export class ChamberAccessService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(AgendaItem) private readonly agenda: Repository<AgendaItem>,
  ) {}

  canAccess(user: AuthUser | null | undefined, chamberId: string): boolean {
    if (!user) return false;
    return user.role === 'superadmin' || (!!user.chamberId && user.chamberId === chamberId);
  }

  assertChamber(user: AuthUser, chamberId: string): void {
    if (!this.canAccess(user, chamberId)) {
      throw new ForbiddenException('Sem acesso a recursos de outra câmara');
    }
  }

  async assertSession(user: AuthUser, sessionId: string): Promise<Session> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    this.assertChamber(user, session.chamberId);
    return session;
  }

  async assertAgendaItem(user: AuthUser, itemId: string): Promise<AgendaItem> {
    const item = await this.agenda.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item da pauta não encontrado');
    this.assertChamber(user, item.chamberId);
    return item;
  }
}
