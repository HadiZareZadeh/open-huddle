import { createServer } from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { getSocketCorsOrigins } from './utils/cors.js';
import { setupSocketHandlers } from './socket/handlers.js';

const app = createApp();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: getSocketCorsOrigins(config),
    credentials: true,
  },
  maxHttpBufferSize: 256 * 1024,
  pingTimeout: 60000,
  pingInterval: config.nodeEnv === 'development' ? 10000 : 25000,
  perMessageDeflate: false,
});

setupSocketHandlers(io);

httpServer.listen(config.port, config.host, () => {
  logger.info(
    { port: config.port, host: config.host, env: config.nodeEnv },
    'Server started',
  );
});

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(
      { port: config.port },
      `Port ${config.port} is already in use. Stop the other process or run run-local.cmd again.`,
    );
    process.exit(1);
  }

  logger.error({ err }, 'Server failed to start');
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  httpServer.close(() => process.exit(0));
});

export { app, httpServer, io };
