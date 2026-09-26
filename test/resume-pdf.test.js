import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { fakeAi, makePdf, RESUME } from './helpers.js';

const URL = '/api/resume/review-pdf?targetRole=Software%20Engineer';
const upload = (app, body, url = URL) => request(app).post(url).set('Content-Type', 'application/pdf').send(body);

test('text PDFs are read on the server, redacted, then reviewed', async () => {
  const ai = fakeAi();
  const res = await upload(createApp({ ai }), makePdf(RESUME.split('\n')));

  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'pdf-text');
  assert.equal(res.body.pages, 1);
  assert.deepEqual(res.body.bulletRewrites.map((r) => r.before), ['Worked on a website for college fest']);
  assert.equal(ai.calls.length, 1, 'only the review call, no transcription');
  assert.equal(ai.calls[0].prompt.includes('test.student@example.com'), false);
  assert.equal(ai.calls[0].prompt.includes('98765'), false);
});

test('scanned PDFs (no text) are transcribed by Gemini, then redacted and reviewed', async () => {
  const transcript = [
    'Scanned Student | scanned@example.com | 9876543210',
    'B.E. Information Technology, 2022 - 2026',
    'Projects: Worked on a website for college fest using React.',
    'Skills: Java, SQL, HTML, CSS, JavaScript',
  ].join('\n');
  const base = fakeAi();
  const ai = {
    calls: base.calls,
    async generateJson(args) {
      if (args.schema.required.join() === 'text') {
        base.calls.push(args);
        return { text: transcript };
      }
      return base.generateJson(args);
    },
  };
  const res = await upload(createApp({ ai }), makePdf());

  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'pdf-gemini');
  const [transcribe, review] = ai.calls;
  assert.equal(transcribe.prompt[0].parts[0].inlineData.mimeType, 'application/pdf');
  assert.equal(review.prompt.includes('scanned@example.com'), false);
  assert.equal(review.prompt.includes('9876543210'), false);
});

test('PDF upload rejects bad files with clear errors', async () => {
  const app = createApp({ ai: fakeAi() });
  assert.equal((await upload(app, Buffer.from('hello, not a pdf'))).body.error, 'This file is not a PDF.');
  assert.equal((await upload(app, Buffer.from('%PDF-1.4 broken'))).status, 400);
  assert.equal((await upload(app, makePdf(['text']), '/api/resume/review-pdf')).status, 400, 'targetRole required');
  assert.equal((await request(app).post(URL).send({})).status, 400, 'wrong content type');
  assert.equal((await upload(app, Buffer.alloc(4 * 1024 * 1024 + 1, 1))).status, 413);
  assert.equal((await upload(createApp({ ai: null }), makePdf(['text']))).status, 503);
});
