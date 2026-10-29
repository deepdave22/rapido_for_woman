import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TokenValidator } from '../auth/token-validator';

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Server → client push only. Every state change still goes through the
 * authenticated REST API; sockets just tell clients something changed so they
 * can update without polling. After a reconnect, clients refetch over REST.
 */
@WebSocketGateway({ namespace: '/realtime', cors: { origin: false } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger('Realtime');

  @WebSocketServer()
  server: Server;

  constructor(private readonly tokens: TokenValidator) {}

  async handleConnection(socket: Socket): Promise<void> {
    const auth = socket.handshake.auth as { token?: unknown };
    try {
      const user = await this.tokens.validate(
        typeof auth.token === 'string' ? auth.token : undefined,
      );
      socket.data.userId = user.userId;
      await socket.join(userRoom(user.userId));
      socket.emit('ready', { userId: user.userId });
    } catch {
      socket.emit('unauthorized', { code: 'UNAUTHENTICATED' });
      socket.disconnect(true);
    }
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn(`Realtime server not ready; dropped ${event}`);
      return;
    }
    this.server.to(userRoom(userId)).emit(event, payload);
  }
}

/** What services depend on, so they don't need to know about sockets. */
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  toUser(userId: string, event: RealtimeEvent, payload: unknown): void {
    this.gateway.emitToUser(userId, event, payload);
  }
}

export type RealtimeEvent =
  'ride.updated' | 'offer.created' | 'offer.withdrawn' | 'driver.location';
