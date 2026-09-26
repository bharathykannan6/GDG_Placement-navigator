import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { fakeAi, PROFILE, SCORES, RESUME } from './helpers.js';

const post = (app, path, body) => request(app).post(path).send(body);

test('AI routes answer 503 when no key is configured', async () => {
  const app = createApp({ ai: null });
  for (const path of ['/api/plan', '/api/resume/review', '/api/interview/question', '/api/interview/feedback']) {
    const res = await post(app, path, {});
    assert.equal(res.status, 503, path);
    assert.match(res.body.error, /not configured/);
  }
});

test('POST /api/plan returns a shaped plan and never sends the name', async () => {
  const ai = fakeAi();
  const res = await post(createApp({ ai }), '/api/plan', { profile: PROFILE, scores: SCORES });

  assert.equal(res.status, 200);
  assert.equal(res.body.summary, 'Focus on communication and CS fundamentals.');
  assert.equal(res.body.weeklyPlan[0].week, 1, 'weeks are renumbered from 1');
  assert.equal(res.body.resources[0].type, 'practice', 'unknown resource types are normalised');
  assert.equal('extraField' in res.body, false);
  assert.ok(Number.isInteger(res.body.weeksLeft) && res.body.weeksLeft >= 1);

  const { prompt, schema } = ai.calls[0];
  assert.equal(prompt.includes(PROFILE.name), false);
  assert.match(prompt, /"CS Fundamentals": 20/);
  assert.ok(schema.required.includes('weeklyPlan'));
});

test('POST /api/plan validates input', async () => {
  const app = createApp({ ai: fakeAi() });
  const bad = [
    { profile: { ...PROFILE, hoursPerWeek: 0 }, scores: SCORES },
    { profile: { ...PROFILE, driveMonth: '2026-13' }, scores: SCORES },
    { profile: PROFILE, scores: { ...SCORES, overall: 101 } },
    { profile: PROFILE, scores: { overall: 50, byArea: {} } },
  ];
  for (const body of bad) assert.equal((await post(app, '/api/plan', body)).status, 400);
});

test('POST /api/resume/review redacts contacts and drops invented rewrites', async () => {
  const ai = fakeAi();
  const res = await post(createApp({ ai }), '/api/resume/review', { resumeText: RESUME, targetRole: 'Software Engineer' });

  assert.equal(res.status, 200);
  assert.equal(res.body.matchScore, 100, 'score is clamped to 0-100');
  assert.deepEqual(res.body.bulletRewrites.map((r) => r.before), ['Worked on a website for college fest']);

  const { prompt } = ai.calls[0];
  assert.equal(prompt.includes('test.student@example.com'), false);
  assert.equal(prompt.includes('98765'), false);
  assert.ok(prompt.includes('[email]') && prompt.includes('[phone]'));
  assert.ok(prompt.includes('2022 - 2026'), 'year ranges are not mistaken for phone numbers');
});

test('POST /api/resume/review validates input', async () => {
  const app = createApp({ ai: fakeAi() });
  assert.equal((await post(app, '/api/resume/review', { resumeText: 'short', targetRole: 'SE' })).status, 400);
  assert.equal((await post(app, '/api/resume/review', { resumeText: RESUME, targetRole: '' })).status, 400);
  assert.equal((await post(app, '/api/resume/review', { resumeText: 'x'.repeat(8001), targetRole: 'SE' })).status, 400);
});

test('POST /api/interview/question returns a question and passes asked list', async () => {
  const ai = fakeAi();
  const res = await post(createApp({ ai }), '/api/interview/question', {
    targetRole: 'Software Engineer',
    round: 'Technical',
    asked: ['What is OOP?'],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { question: 'What is a deadlock?', tip: 'Name the four conditions.' });
  assert.match(ai.calls[0].prompt, /- What is OOP\?/);
});

test('POST /api/interview/feedback clamps scores and computes overall', async () => {
  const res = await post(createApp({ ai: fakeAi() }), '/api/interview/feedback', {
    question: 'Tell me about a conflict in your team.',
    answer: 'In my project we disagreed about the database, so we tested both options.',
    round: 'HR',
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.scores, { relevance: 4, structure: 2, clarity: 3, depth: 5 });
  assert.equal(res.body.overall, 3.5);
});

test('interview routes validate input', async () => {
  const app = createApp({ ai: fakeAi() });
  assert.equal((await post(app, '/api/interview/question', { targetRole: 'SE', round: 'Group' })).status, 400);
  assert.equal((await post(app, '/api/interview/question', { targetRole: 'SE', round: 'HR', asked: 'x' })).status, 400);
  assert.equal((await post(app, '/api/interview/feedback', { question: 'Why?', answer: 'too short', round: 'HR' })).status, 400);
});

test('AI failures return a safe message; unexpected errors do not leak details', async (t) => {
  t.mock.method(console, 'error', () => {}); // keep test output clean
  const aiDown = await post(createApp({ ai: fakeAi({ fail: 'ai' }) }), '/api/interview/question', { targetRole: 'SE', round: 'HR' });
  assert.equal(aiDown.status, 502);
  assert.equal(aiDown.body.error, 'The AI service did not respond. Please try again.');

  const crash = await post(createApp({ ai: fakeAi({ fail: 'crash' }) }), '/api/interview/question', { targetRole: 'SE', round: 'HR' });
  assert.equal(crash.status, 500);
  assert.equal(crash.body.error, 'Something went wrong, please try again.');
  assert.equal(JSON.stringify(crash.body).includes('internal detail'), false);
});

test('AI routes are rate limited per client', async () => {
  const app = createApp({ ai: fakeAi(), aiRequestsPerMinute: 2 });
  const body = { targetRole: 'Software Engineer', round: 'HR' };
  assert.equal((await post(app, '/api/interview/question', body)).status, 200);
  assert.equal((await post(app, '/api/interview/question', body)).status, 200);
  const limited = await post(app, '/api/interview/question', body);
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /Too many requests/);
});

test('POST /api/interview/report computes scores and verdict in code', async () => {
  const ai = fakeAi();
  const item = (relevance, structure, clarity, depth, round = 'HR') => ({
    question: 'Tell me about a challenge you faced.',
    answer: 'In my project we missed a deadline, so I split the work and we shipped a day later.',
    round,
    scores: { relevance, structure, clarity, depth },
  });
  const res = await post(createApp({ ai }), '/api/interview/report', {
    targetRole: 'Software Engineer',
    items: [item(4, 3, 4, 3), item(5, 4, 4, 2, 'Technical'), item(4, 3, 4, 3), item(5, 4, 4, 2, 'Technical'), item(4, 3, 4, 3)],
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.averages, { relevance: 4.4, structure: 3.4, clarity: 4, depth: 2.6 });
  assert.equal(res.body.overall, 3.6);
  assert.equal(res.body.verdict, 'Promising');
  assert.equal(res.body.questionCount, 5);
  assert.equal(res.body.focusAreas.length, 3, 'lists are capped at 3');
  assert.match(ai.calls[0].prompt, /Question 2 \(Technical\)/);
});

test('POST /api/interview/report validates items', async () => {
  const app = createApp({ ai: fakeAi() });
  const good = { question: 'Why this role?', answer: 'Because I enjoy building products.', round: 'HR', scores: { relevance: 3, structure: 3, clarity: 3, depth: 3 } };
  assert.equal((await post(app, '/api/interview/report', { items: [good, good] })).status, 400);
  assert.equal((await post(app, '/api/interview/report', { items: Array(6).fill(good) })).status, 400);
  assert.equal((await post(app, '/api/interview/report', { items: [good, good, { ...good, scores: { ...good.scores, depth: 6 } }] })).status, 400);
  assert.equal((await post(app, '/api/interview/report', { items: [good, good, { ...good, round: 'Group' }] })).status, 400);
});
