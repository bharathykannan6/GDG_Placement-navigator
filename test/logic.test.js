import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini, AiError, modelConfig } from '../src/gemini.js';
import { weeksUntil } from '../src/routes/plan.js';
import { redactContacts } from '../src/routes/resume.js';
import { analyseAnswer, formatDuration } from '../public/js/speech-stats.js';
import { attemptDeltas, interviewSummary, planCompletion, signed } from '../public/js/progress-stats.js';

const fakeClient = (impl) => ({ models: { generateContent: impl } });

test('generateJson asks for JSON with the schema and parses the reply', async () => {
  let request;
  const ai = createGemini({ model: 'test-model', client: fakeClient(async (req) => { request = req; return { text: '{"ok":true}' }; }) });
  const schema = { type: 'object' };
  assert.deepEqual(await ai.generateJson({ system: 'sys', prompt: 'hi', schema }), { ok: true });
  assert.equal(request.model, 'test-model');
  assert.equal(request.config.responseMimeType, 'application/json');
  assert.equal(request.config.responseJsonSchema, schema);
  assert.equal(request.config.systemInstruction, 'sys');
});

test('generateJson turns SDK errors and bad JSON into safe AiErrors', async () => {
  const broken = createGemini({ log: () => {}, client: fakeClient(async () => ({ text: 'not json' })) });
  await assert.rejects(broken.generateJson({}), (err) => err instanceof AiError && err.status === 502);

  const failing = createGemini({ log: () => {}, client: fakeClient(async () => { throw new Error('key=SECRET'); }) });
  await assert.rejects(failing.generateJson({}), (err) => err instanceof AiError && !err.message.includes('SECRET'));
});

test('SDK errors map to messages that say what to fix', async () => {
  const failWith = (err) => createGemini({ log: () => {}, retryDelayMs: 0, client: fakeClient(async () => { throw err; }) }).generateJson({});
  const message = async (err) => { try { await failWith(err); } catch (e) { return e.message; } return null; };
  assert.match(await message(Object.assign(new Error('API key not valid. Please pass a valid API key.'), { status: 400 })), /GEMINI_API_KEY/);
  assert.match(await message(Object.assign(new Error('Resource exhausted'), { status: 429 })), /quota/);
  assert.match(await message(Object.assign(new Error('models/x is not found'), { status: 404 })), /GEMINI_MODEL/);
  assert.equal(await message(new Error('socket hang up')), 'The AI service did not respond. Please try again.');
});

test('an overloaded model is retried once, then the fallback model answers', async () => {
  const calls = [];
  const logs = [];
  const overloaded = Object.assign(new Error('This model is currently experiencing high demand.'), { status: 503 });
  const ai = createGemini({
    model: 'primary',
    fallbackModels: ['backup', 'last'],
    retryDelayMs: 0,
    log: (line) => logs.push(line),
    client: fakeClient(async (req) => {
      calls.push(req.model);
      if (req.model === 'primary') throw overloaded;
      return { text: '{"ok":true}' };
    }),
  });

  assert.deepEqual(await ai.generateJson({ schema: {} }), { ok: true });
  assert.deepEqual(calls, ['primary', 'primary', 'backup']);
  assert.ok(logs.some((l) => l.includes('fallback model backup')));
  assert.deepEqual(ai.models, ['primary', 'backup', 'last']);
});

test('missing models are skipped at once; key errors never fall back', async () => {
  const calls = [];
  const notFound = Object.assign(new Error('model not found'), { status: 404 });
  const skip = createGemini({
    model: 'gone',
    fallbackModels: ['works'],
    retryDelayMs: 0,
    log: () => {},
    client: fakeClient(async (req) => {
      calls.push(req.model);
      if (req.model === 'gone') throw notFound;
      return { text: '{"n":1}' };
    }),
  });
  assert.deepEqual(await skip.generateJson({ schema: {} }), { n: 1 });
  assert.deepEqual(calls, ['gone', 'works'], '404 is not retried on the same model');

  const keyCalls = [];
  const badKey = createGemini({
    model: 'a',
    fallbackModels: ['b'],
    log: () => {},
    client: fakeClient(async (req) => {
      keyCalls.push(req.model);
      throw Object.assign(new Error('API key not valid.'), { status: 400 });
    }),
  });
  await assert.rejects(badKey.generateJson({ schema: {} }), /GEMINI_API_KEY/);
  assert.deepEqual(keyCalls, ['a']);
});

test('only Gemini 2.5 models get thinking turned off', async () => {
  assert.deepEqual(modelConfig('gemini-2.5-flash'), { thinkingConfig: { thinkingBudget: 0 } });
  assert.deepEqual(modelConfig('gemini-flash-latest'), {});
  assert.deepEqual(modelConfig('gemini-flash-lite-latest'), {});

  const seen = [];
  const ai = createGemini({
    model: 'gemini-flash-latest',
    fallbackModels: ['gemini-2.5-flash'],
    retryDelayMs: 0,
    log: () => {},
    client: fakeClient(async (req) => {
      seen.push([req.model, req.config.thinkingConfig ?? null]);
      if (req.model === 'gemini-flash-latest') throw Object.assign(new Error('not found'), { status: 404 });
      return { text: '{}' };
    }),
  });
  await ai.generateJson({ schema: {} });
  assert.deepEqual(seen, [['gemini-flash-latest', null], ['gemini-2.5-flash', { thinkingBudget: 0 }]]);
});

test('when every model is overloaded the message says so', async () => {
  const ai = createGemini({
    model: 'a',
    fallbackModels: ['b'],
    retryDelayMs: 0,
    log: () => {},
    client: fakeClient(async () => { throw Object.assign(new Error('high demand'), { status: 503 }); }),
  });
  await assert.rejects(ai.generateJson({ schema: {} }), /overloaded right now/);
});

test('weeksUntil counts whole weeks to the 1st of the month, at least 1', () => {
  const today = new Date(Date.UTC(2026, 8, 26)); // 26 Sep 2026
  assert.equal(weeksUntil('2026-12', today), 10); // 66 days
  assert.equal(weeksUntil('2026-10', today), 1); // 5 days rounds up to 1
  assert.equal(weeksUntil('2026-09', today), 1); // already started
  assert.equal(weeksUntil('2030-01', today), 52); // capped
});

test('redactContacts removes emails and Indian mobile numbers only', () => {
  assert.equal(redactContacts('Mail a.b+c@college.ac.in now'), 'Mail [email] now');
  assert.equal(redactContacts('Call +91 98765 43210'), 'Call [phone]');
  assert.equal(redactContacts('Call 9876543210.'), 'Call [phone].');
  assert.equal(redactContacts('B.E. 2022 - 2026, CGPA 8.2'), 'B.E. 2022 - 2026, CGPA 8.2');
});

test('analyseAnswer counts words, speaking time and filler words', () => {
  const a = analyseAnswer('So basically in my project, um, we like disagreed and I, you know, fixed it.');
  assert.equal(a.words, 15);
  assert.deepEqual(a.fillers, { um: 1, like: 1, basically: 1, 'you know': 1, so: 1 });
  assert.equal(a.fillerTotal, 5);
  assert.equal(a.seconds, 7); // 15 words at 130 wpm
  assert.deepEqual(analyseAnswer('   '), { words: 0, seconds: 0, fillers: {}, fillerTotal: 0, fillerRate: 0 });
  assert.equal(analyseAnswer('Summary: also soft skills').fillerTotal, 0, 'only whole words count');
  assert.equal(formatDuration(75), '1 min 15 s');
  assert.equal(formatDuration(40), '40 s');
});

test('attemptDeltas compares the last two attempts', () => {
  const attempt = (overall, dsa) => ({ overall, byArea: { DSA: { percent: dsa } } });
  assert.equal(attemptDeltas([attempt(50, 40)]), null);
  assert.deepEqual(attemptDeltas([attempt(10, 0), attempt(50, 40), attempt(45, 60)]), { overall: -5, byArea: { DSA: 20 } });
  assert.equal(signed(20), '+20');
  assert.equal(signed(-5), '-5');
  assert.equal(signed(0), '0');
});

test('interviewSummary averages the last 5 answers per round', () => {
  const answers = [1, 2, 3, 4, 5, 5].map((overall) => ({ round: 'HR', overall, fillerTotal: 2 }));
  const summary = interviewSummary(answers);
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.rounds.HR, { count: 5, average: 3.8, fillersPerAnswer: 2 });
  assert.equal(summary.rounds.Technical, null);
});

test('planCompletion counts ticked tasks', () => {
  const saved = { plan: { weeklyPlan: [{ tasks: ['a', 'b'] }, { tasks: ['c', 'd'] }] }, done: { 'w1-t0': true, 'w1-t1': false, 'w2-t0': true } };
  assert.deepEqual(planCompletion(saved), { done: 2, total: 4, percent: 50 });
  assert.equal(planCompletion(null), null);
});
