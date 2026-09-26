import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { createGemini } from './gemini.js';
import { diagnosticRouter } from './routes/diagnostic.js';
import { planRouter } from './routes/plan.js';
import { resumeRouter } from './routes/resume.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

function aiFromEnv() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not set: AI features will answer 503 until it is configured.');
    return null;
  }
  return createGemini({ apiKey, model: process.env.GEMINI_MODEL || 'gemini-flash-latest' });
}

/**
 * Builds the Express app. Pass `ai` to inject a fake model in tests,
 * or `ai: null` to simulate a server without a key.
 */
export function createApp({ ai = aiFromEnv() } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(publicDir));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', ai: ai ? 'configured' : 'missing' });
  });

  app.use('/api/diagnostic', diagnosticRouter());
  app.use('/api/plan', planRouter(ai));
  app.use('/api/resume', resumeRouter(ai));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.name === 'ValidationError' || err.name === 'AiError') {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  });

  return app;
}
