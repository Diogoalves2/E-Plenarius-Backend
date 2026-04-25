import {
  WebSocketGateway, WebSocketServer,
  SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect,
  ConnectedSocket, MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { AgendaService } from '../agenda/agenda.service';

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/voting',
})
export class VotingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VotingGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly agendaService: AgendaService,
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
    client.join(`session:${data.sessionId}`);
    this.logger.log(`${client.data.user?.email ?? 'guest'} joined session:${data.sessionId}`);

    // Envia o estado atual da votação para quem acabou de entrar
    const activeItem = await this.agendaService.findActiveVoting(data.sessionId);
    client.emit('voting:state', {
      item: activeItem ?? null,
      counts: activeItem ? {
        sim: activeItem.votesYes ?? 0,
        nao: activeItem.votesNo ?? 0,
        abstencao: activeItem.votesAbstain ?? 0,
      } : { sim: 0, nao: 0, abstencao: 0 },
      open: !!activeItem,
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

  emitToSession(sessionId: string, event: string, data: any) {
    this.server.to(`session:${sessionId}`).emit(event, data);
  }

  emitToChamber(chamberId: string, event: string, data: any) {
    this.server.to(`chamber:${chamberId}`).emit(event, data);
  }
}
