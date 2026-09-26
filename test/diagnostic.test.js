import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../src/app.js';

const bank = JSON.parse(readFileSync(new URL('../data/questions.json', import.meta.url), 'utf8'));
const app = createApp({ ai: null });

const score = (body) => request(app).post('/api/diagnostic/score').send(body);

test('question bank is well formed: 20 questions, 5 per area, valid answers', () => {
  assert.equal(bank.length, 20);
  const perArea = {};
  for (const q of bank) {
    perArea[q.area] = (perArea[q.area] ?? 0) + 1;
    assert.equal(q.options.length, 4, q.id);
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4, q.id);
    assert.ok(q.explanation.length > 10, q.id);
  }
  assert.deepEqual(perArea, { Aptitude: 5, DSA: 5, 'CS Fundamentals': 5, Communication: 5 });
  assert.equal(new Set(bank.map((q) => q.id)).size, 20, 'ids are unique');
});

test('questions endpoint never exposes answers or explanations', async () => {
  const res = await request(app).get('/api/diagnostic/questions');
  assert.equal(res.status, 200);
  assert.equal(res.body.questions.length, 20);
  for (const q of res.body.questions) {
    assert.equal('answer' in q, false);
    assert.equal('explanation' in q, false);
  }
});

test('all correct answers score 100', async () => {
  const answers = Object.fromEntries(bank.map((q) => [q.id, q.answer]));
  const res = await score({ answers });
  assert.equal(res.status, 200);
  assert.equal(res.body.overall, 100);
  for (const stats of Object.values(res.body.byArea)) assert.equal(stats.percent, 100);
});

test('all wrong or unanswered scores 0', async () => {
  const wrong = Object.fromEntries(bank.map((q) => [q.id, (q.answer + 1) % 4]));
  assert.equal((await score({ answers: wrong })).body.overall, 0);
  assert.equal((await score({ answers: {} })).body.overall, 0);
});

test('partial answers score per area', async () => {
  const aptitudeOnly = Object.fromEntries(bank.filter((q) => q.area === 'Aptitude').map((q) => [q.id, q.answer]));
  const res = await score({ answers: aptitudeOnly });
  assert.equal(res.body.overall, 25);
  assert.equal(res.body.byArea.Aptitude.percent, 100);
  assert.equal(res.body.byArea.DSA.percent, 0);
  assert.equal(res.body.review.length, 20);
});

test('invalid input is rejected with 400', async () => {
  const cases = [
    {},
    { answers: [1, 2] },
    { answers: { 'no-such-id': 1 } },
    { answers: { 'apt-1': 4 } },
    { answers: { 'apt-1': '1' } },
    { answers: { 'apt-1': 1.5 } },
  ];
  for (const body of cases) {
    const res = await score(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.body.error);
  }
});

test('malformed JSON is rejected with 400', async () => {
  const res = await request(app)
    .post('/api/diagnostic/score')
    .set('Content-Type', 'application/json')
    .send('{not json');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Request body must be valid JSON.');
});
