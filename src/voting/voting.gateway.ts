import {
  WebSocketGateway, WebSocketServer,
  SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect,
  ConnectedSocket, MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { AgendaService } from '../agenda/agenda.service';
import { ChambersService } from '../chambers/chambers.service';
import { maskSecretCounts } from '../common/integrity';

/**
 * Navegador só conecta a partir do painel oficial (FRONTEND_URL). App nativo e bridge não
 * mandam Origin e seguem liberados. Lido a cada conexão (o .env pode carregar depois do import).
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const list = (process.env.FRONTEND_URL ?? '').split(',').map(o => o.trim()).filter(Boolean);
  return list.length === 0 || list.includes(origin);
}

@WebSocketGateway({
  cors: { origin: (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => cb(null, originAllowed(origin)), credentials: true },
  // allowRequest vale também para WebSocket puro (o navegador não aplica CORS a ele)
  allowRequest: (req: any, cb: (err: string | null | undefined, ok: boolean) => void) => cb(null, originAllowed(req.headers.origin)),
  namespace: '/voting',
})
export class VotingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VotingGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly agendaService: AgendaService,
    private readonly chambersService: ChambersService,
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
    if (!token) {
      // Allow unauthenticated viewers (e.g. telão display screen)
      client.data.user = null;
      this.logger.log(`Guest client connected: ${client.id}`);
      return;
    }
    try {
      const payload = this.jwtService.verify(token);
      client.data.user = payload;
      this.logger.log(`Client connected: ${payload.email}`);
    } catch {
      // Expired/invalid token — allow as guest instead of disconnecting
      client.data.user = null;
      this.logger.log(`Client connected with invalid token (guest): ${client.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('session:join')
  async handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    if (!data || typeof data.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.sessionId)) return;
    client.join(`session:${data.sessionId}`);
    this.logger.log(`${client.data.user?.email ?? 'guest'} joined session:${data.sessionId}`);

    // Envia o estado atual da votação para quem acabou de entrar
    const active = await this.agendaService.findActiveVoting(data.sessionId);
    const item = active ? maskSecretCounts(active) : null;
    client.emit('voting:state', {
      item,
      // Secreta em andamento: placar parcial oculto (null) — só o total.
      counts: !item
        ? { sim: 0, nao: 0, abstencao: 0 }
        : item.countsHidden
          ? null
          : { sim: item.votesYes ?? 0, nao: item.votesNo ?? 0, abstencao: item.votesAbstain ?? 0 },
      totalVotes: item?.votesTotal ?? 0,
      open: !!item,
    });

    return { event: 'session:joined', data: { sessionId: data.sessionId } };
  }

  @SubscribeMessage('session:leave')
  handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    client.leave(`session:${data.sessionId}`);
  }

  @SubscribeMessage('chamber:join_by_slug')
  async handleJoinChamberBySlug(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { slug: string },
  ) {
    try {
      const chamber = await this.chambersService.findBySlug(data.slug);
      client.join(`chamber:${chamber.id}`);
      this.logger.log(`Bridge/client joined chamber:${chamber.id} via slug=${data.slug}`);
      return { event: 'chamber:joined', data: { chamberId: chamber.id, name: chamber.name } };
    } catch (err: any) {
      return { event: 'chamber:join_failed', data: { error: err?.message ?? 'erro' } };
    }
  }

  emitToSession(sessionId: string, event: string, data: any) {
    this.server.to(`session:${sessionId}`).emit(event, data);
  }

  emitToChamber(chamberId: string, event: string, data: any) {
    this.server.to(`chamber:${chamberId}`).emit(event, data);
  }
}
