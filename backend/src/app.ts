import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { getCorsConfig } from './utils/cors.js';
import meetingRoutes from './routes/meetings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:'],
              mediaSrc: ["'self'", 'blob:'],
              connectSrc: ["'self'", 'wss:', 'ws:', 'https:', 'http:'],
              workerSrc: ["'self'", 'blob:'],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(cors(getCorsConfig(config)));

  app.use(express.json({ limit: '16kb' }));

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req: { url?: string }) => req.url === '/api/health',
      },
    }),
  );

  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });

  if (config.rateLimitMax > 0) {
    app.use('/api', limiter);
  }

  app.use('/api', meetingRoutes);

  if (config.isProduction) {
    const frontendPath = path.resolve(__dirname, config.frontendDist);
    app.use(express.static(frontendPath));

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        next();
        return;
      }
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
  }

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      logger.error({ err }, 'Unhandled error');
      res.status(500).json({ error: 'Internal server error' });
    },
  );

  return app;
}
