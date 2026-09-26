import { GoogleGenAI } from '@google/genai';

const TIMEOUT_MS = 30_000;

/** Error whose message is safe to show to the user (no keys, no prompts). */
export class AiError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'AiError';
    this.status = 502;
  }
}

/**
 * Wraps the Gemini SDK so every feature gets parsed JSON back.
 * `client` can be injected for tests; otherwise a real SDK client is created.
 */
export function createGemini({ apiKey, model = 'gemini-flash-latest', client } = {}) {
  const sdk = client ?? new GoogleGenAI({ apiKey });

  return {
    model,
    async generateJson({ system, prompt, schema, temperature = 0.4 }) {
      let response;
      try {
        response = await sdk.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            temperature,
            abortSignal: AbortSignal.timeout(TIMEOUT_MS),
          },
        });
      } catch (err) {
        throw new AiError('The AI service did not respond. Please try again.', { cause: err });
      }

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
