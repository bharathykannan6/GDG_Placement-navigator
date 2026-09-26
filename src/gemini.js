import { GoogleGenAI } from '@google/genai';

const ATTEMPT_TIMEOUT_MS = 40_000; // one model call
const TOTAL_BUDGET_MS = 75_000; // all retries and fallbacks together
const RETRYABLE = new Set([500, 502, 503, 504]); // temporary problems on Google's side

export const DEFAULT_MODEL = 'gemini-flash-latest';

/**
 * Gemini 2.5 models "think" by default: a full prep plan took ~24 s on gemini-2.5-flash
 * in testing, and ~7 s with thinkingBudget 0. Only 2.5 models get this setting.
 */
export function modelConfig(name) {
  return name.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {};
}
export const DEFAULT_FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-flash-lite-latest'];

/** Error whose message is safe to show to the user (no keys, no prompts). */
export class AiError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'AiError';
    this.status = 502;
  }
}

const isKeyError = (err) => /api key/i.test(String(err?.message ?? '')) || err?.status === 401 || err?.status === 403;
const isTimeout = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';

/** Turns an SDK error into a message that says what to fix, without leaking details. */
function explain(err) {
  const status = err?.status;
  if (isKeyError(err)) return 'The Gemini API key on the server is not valid. Check GEMINI_API_KEY.';
  if (status === 429) return 'The AI is busy or the API quota is used up. Please wait a minute and try again.';
  if (status === 404) return 'The Gemini model is not available. Check GEMINI_MODEL.';
  if (RETRYABLE.has(status)) return 'Gemini is overloaded right now (a temporary problem on Google\'s side). Please try again in a minute.';
  if (isTimeout(err)) return 'Gemini took too long to answer. Please try again.';
  return 'The AI service did not respond. Please try again.';
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Wraps the Gemini SDK so every feature gets parsed JSON back.
 * If a model is overloaded (5xx), it retries once, then moves on to the fallback
 * models. If a model is missing (404) or rate-limited (429), it moves on at once.
 * Key errors stop immediately. `client` can be injected for tests.
 */
export function createGemini({
  apiKey,
  model = DEFAULT_MODEL,
  fallbackModels = DEFAULT_FALLBACK_MODELS,
  client,
  retryDelayMs = 800,
  log = console.warn,
} = {}) {
  const sdk = client ?? new GoogleGenAI({ apiKey });
  const models = [model, ...fallbackModels.filter((m) => m && m !== model)];

  async function callModel(name, { system, prompt, schema, temperature }) {
    return sdk.models.generateContent({
      model: name,
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        temperature,
        abortSignal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        ...modelConfig(name),
      },
    });
  }

  return {
    model,
    models,
    async generateJson({ system, prompt, schema, temperature = 0.4 }) {
      const started = Date.now();
      let lastError;
      let response;

      for (const [index, name] of models.entries()) {
        for (let attempt = 1; attempt <= 2 && !response; attempt += 1) {
          try {
            response = await callModel(name, { system, prompt, schema, temperature });
          } catch (err) {
            lastError = err;
            if (isKeyError(err)) throw new AiError(explain(err), { cause: err });
            const retrySameModel = attempt === 1 && RETRYABLE.has(err?.status) && Date.now() - started < TOTAL_BUDGET_MS / 2;
            if (!retrySameModel) break;
            await sleep(retryDelayMs);
          }
        }
        if (response) {
          if (index > 0) log(`Gemini: answered by fallback model ${name}`);
          break;
        }
        const next = models[index + 1];
        if (!next || Date.now() - started > TOTAL_BUDGET_MS) break;
        log(`Gemini: ${name} failed (${lastError?.status ?? lastError?.name ?? 'error'}), trying ${next}`);
      }

      if (!response) throw new AiError(explain(lastError), { cause: lastError });

      try {
        return JSON.parse(response.text);
      } catch (err) {
        throw new AiError('The AI returned an answer we could not read. Please try again.', { cause: err });
      }
    },
  };
}

/** Express middleware: 503 when the server has no Gemini key configured. */
export function requireAi(ai) {
  return (req, res, next) => {
    if (!ai) {
      res.status(503).json({ error: 'AI is not configured on this server. Add GEMINI_API_KEY and restart.' });
      return;
    }
    next();
  };
}
