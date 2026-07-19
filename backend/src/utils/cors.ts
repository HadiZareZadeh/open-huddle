import type { CorsOptions } from 'cors';
import type { AppConfig } from '../config/index.js';

const PRIVATE_LAN_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export function getCorsConfig(appConfig: AppConfig): CorsOptions {
  const allowLan =
    process.env.CORS_ALLOW_LAN === 'true' ||
    (!appConfig.isProduction && process.env.CORS_ALLOW_LAN !== 'false');

  if (!allowLan) {
    return {
      origin: appConfig.corsOrigins,
      credentials: true,
    };
  }

  return {
    origin(origin, callback) {
      if (
        !origin ||
        appConfig.corsOrigins.includes(origin) ||
        PRIVATE_LAN_ORIGIN.test(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  };
}

export function getSocketCorsOrigins(appConfig: AppConfig): CorsOptions['origin'] {
  const cors = getCorsConfig(appConfig);
  return cors.origin;
}
