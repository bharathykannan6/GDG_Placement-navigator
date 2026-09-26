import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(publicDir));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
