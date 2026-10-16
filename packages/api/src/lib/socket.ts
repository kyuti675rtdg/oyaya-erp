import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';

let io: Server | null = null;

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/socket.io',
  });
  io.on('connection', (socket) => {
    console.log(`[socket] client connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`[socket] client disconnected: ${socket.id}`);
    });
  });
  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io has not been initialized');
  return io;
}

/** Best-effort broadcast; safe to call before init (no-op). */
export function emitEvent(event: string, payload: unknown): void {
  if (io) io.emit(event, payload);
}
