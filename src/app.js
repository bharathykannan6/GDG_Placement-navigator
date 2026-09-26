import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { DEFAULT_FALLBACK_MODELS, DEFAULT_MODEL, createGemini } from './gemini.js';
import { diagnosticRouter } from './routes/diagnostic.js';
import { planRouter } from './routes/plan.js';
import { resumeRouter } from './routes/resume.js';
import { interviewRouter } from './routes/interview.js';
import { codingRouter } from './routes/coding.js';
import { mentorRouter } from './routes/mentor.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

function aiFromEnv() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not set: AI features will answer 503 until it is configured.');
    return null;
  }
  const fallbackModels = process.env.GEMINI_FALLBACK_MODELS
    ? process.env.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean)
    : DEFAULT_FALLBACK_MODELS;
  const ai = createGemini({ apiKey, model: process.env.GEMINI_MODEL || DEFAULT_MODEL, fallbackModels });
  console.log(`Gemini models (in order): ${ai.models.join(', ')}`);
  return ai;
}

function limiter(limit) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a minute and try again.' },
  });
}

/**
 * Builds the Express app. Pass `ai` to inject a fake model in tests,
 * or `ai: null` to simulate a server without a key.
 * `aiRequestsPerMinute` caps AI calls per client IP (protects the API key quota).
 */
export function createApp({ ai = aiFromEnv(), aiRequestsPerMinute = 20 } = {}) {
  const app = express();

  // Cloud Run sits behind one Google front-end proxy; trust exactly that hop
  // so rate limiting sees the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());

  // The coding-practice worker runs the student's own code in their browser, so it
  // needs 'unsafe-eval'. It gets its own strict policy: no network, no imports.
  app.get('/js/code-runner.worker.js', (req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-eval'");
    next();
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(publicDir));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', ai: ai ? 'configured' : 'missing' });
  });

  const aiLimit = limiter(aiRequestsPerMinute);
  app.use('/api', limiter(120));
  app.use('/api/diagnostic', diagnosticRouter());
  app.use('/api/plan', aiLimit, planRouter(ai));
  app.use('/api/resume', aiLimit, resumeRouter(ai));
  app.use('/api/interview', aiLimit, interviewRouter(ai));
  app.use('/api/coding/review', aiLimit);
  app.use('/api/coding', codingRouter(ai));
  app.use('/api/mentor', aiLimit, mentorRouter(ai));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body must be valid JSON.' });
      return;
    }
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body is too large.' });
      return;
    }
    if (err.name === 'ValidationError') {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err.name === 'AiError') {
      console.error(`AI call failed: ${err.cause?.message ?? err.message}`);
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  });

  return app;
}
