import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { fakeAi } from './helpers.js';

test('GET /api/health reports ok and AI status', async () => {
  const withAi = await request(createApp({ ai: fakeAi() })).get('/api/health');
  assert.equal(withAi.status, 200);
  assert.deepEqual(withAi.body, { status: 'ok', ai: 'configured' });

  const withoutAi = await request(createApp({ ai: null })).get('/api/health');
  assert.equal(withoutAi.body.ai, 'missing');
});

test('serves the frontend with security headers', async () => {
  const res = await request(createApp({ ai: null })).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /Placement/);
  assert.ok(res.headers['content-security-policy']);
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('unknown API routes return JSON 404', async () => {
  const res = await request(createApp({ ai: null })).get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'Not found.' });
});
