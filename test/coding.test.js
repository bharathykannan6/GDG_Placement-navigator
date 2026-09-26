import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { fakeAi } from './helpers.js';

const problems = JSON.parse(readFileSync(new URL('../data/coding-problems.json', import.meta.url), 'utf8'));

// Independent reference solutions: every expected answer in the bank must match them.
const reference = {
  twoSum(nums, target) {
    const seen = new Map();
    for (let i = 0; i < nums.length; i += 1) {
      if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];
      seen.set(nums[i], i);
    }
    return null;
  },
  isValid(s) {
    const stack = [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    for (const c of s) {
      if ('([{'.includes(c)) stack.push(c);
      else if (stack.pop() !== pairs[c]) return false;
    }
    return stack.length === 0;
  },
  isPalindrome(s) {
    const t = s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return t === [...t].reverse().join('');
  },
  maxSubArray(nums) {
    let best = nums[0];
    let current = 0;
    for (const x of nums) {
      current = Math.max(x, current + x);
      best = Math.max(best, current);
    }
    return best;
  },
  search(nums, target) {
    let lo = 0;
    let hi = nums.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nums[mid] === target) return mid;
      if (nums[mid] < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  },
  firstUniqChar(s) {
    const count = {};
    for (const c of s) count[c] = (count[c] ?? 0) + 1;
    for (let i = 0; i < s.length; i += 1) if (count[s[i]] === 1) return i;
    return -1;
  },
  climbStairs(n) {
    let a = 1;
    let b = 1;
    for (let i = 2; i <= n; i += 1) [a, b] = [b, a + b];
    return b;
  },
  missingNumber(nums) {
    const n = nums.length;
    return (n * (n + 1)) / 2 - nums.reduce((x, y) => x + y, 0);
  },
};

test('every coding test case matches an independent reference solution', () => {
  assert.equal(problems.length, 8);
  for (const p of problems) {
    assert.ok(reference[p.functionName], `reference for ${p.functionName}`);
    assert.deepEqual(Object.keys(p.signatures).sort(), ['cpp', 'java', 'javascript', 'python']);
    for (const t of p.tests) {
      assert.deepEqual(reference[p.functionName](...structuredClone(t.args)), t.expected, `${p.id} ${JSON.stringify(t.args)}`);
    }
  }
});

test('GET /api/coding/problems lists problems and languages', async () => {
  const res = await request(createApp({ ai: null })).get('/api/coding/problems');
  assert.equal(res.status, 200);
  assert.equal(res.body.problems.length, 8);
  assert.deepEqual(res.body.languages, ['javascript', 'python', 'java', 'cpp']);
});

test('the code-runner worker gets its own locked-down CSP; pages keep the strict one', async () => {
  const app = createApp({ ai: null });
  const worker = await request(app).get('/js/code-runner.worker.js');
  assert.equal(worker.status, 200);
  assert.equal(worker.headers['content-security-policy'], "default-src 'none'; script-src 'self' 'unsafe-eval'");

  const page = await request(app).get('/');
  assert.equal(page.headers['content-security-policy'].includes('unsafe-eval'), false);
});

test('POST /api/coding/review is labelled as not executed unless tests were run', async () => {
  const ai = fakeAi();
  const app = createApp({ ai });
  const java = await request(app).post('/api/coding/review').send({
    problemId: 'two-sum',
    language: 'java',
    code: 'class Solution { public int[] twoSum(int[] nums, int target) { return nums; } }',
  });
  assert.equal(java.status, 200);
  assert.equal(java.body.executed, false);
  assert.equal(java.body.verdict, 'Has bugs');
  assert.match(ai.calls[0].prompt, /NOT executed/);

  const js = await request(app).post('/api/coding/review').send({
    problemId: 'two-sum',
    language: 'javascript',
    code: 'function twoSum(nums, target) { return [0, 1]; }',
    testSummary: { passed: 2, total: 6 },
  });
  assert.equal(js.body.executed, true);
  assert.deepEqual(js.body.testSummary, { passed: 2, total: 6 });
  assert.match(ai.calls[1].prompt, /2 of 6 test cases passed/);
});

test('POST /api/coding/review validates input and needs a key', async () => {
  const app = createApp({ ai: fakeAi() });
  const bad = [
    { problemId: 'nope', language: 'java', code: 'xxxxxxxxxxxx' },
    { problemId: 'two-sum', language: 'ruby', code: 'xxxxxxxxxxxx' },
    { problemId: 'two-sum', language: 'java', code: 'x' },
    { problemId: 'two-sum', language: 'javascript', code: 'xxxxxxxxxxxx', testSummary: { passed: 7, total: 6 } },
  ];
  for (const body of bad) assert.equal((await request(app).post('/api/coding/review').send(body)).status, 400);

  const noKey = await request(createApp({ ai: null })).post('/api/coding/review').send({});
  assert.equal(noKey.status, 503);
});
