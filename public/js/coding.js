import { api } from './api.js';
import { h, clear } from './dom.js';
import { load, save } from './store.js';

const TEST_TIME_LIMIT_MS = 2000;
const LANGUAGE_NAMES = { javascript: 'JavaScript', python: 'Python', java: 'Java', cpp: 'C++' };

let problems = null;
let currentId = null;
let language = 'javascript';
let lastRun = null; // { problemId, language, code, passed, total }

const $ = (id) => document.getElementById(id);

export function getCodingProgress() {
  return load('coding', {});
}

export function starterCode(problem, lang) {
  const sig = problem.signatures[lang];
  switch (lang) {
    case 'python':
      return `${sig}\n    # Write your solution here\n    pass\n`;
    case 'java':
      return `class Solution {\n    ${sig} {\n        // Write your solution here\n    }\n}\n`;
    case 'cpp':
      return `class Solution {\npublic:\n    ${sig} {\n        // Write your solution here\n    }\n};\n`;
    default:
      return `${sig} {\n  // Write your solution here\n}\n`;
  }
}

function codeKey(id, lang) {
  return `${id}:${lang}`;
}

function savedCode(problem, lang) {
  return load('code', {})[codeKey(problem.id, lang)] ?? starterCode(problem, lang);
}

function storeCode(problem, lang, code) {
  const all = load('code', {});
  all[codeKey(problem.id, lang)] = code;
  save('code', all);
}

function call(problem, args) {
  return `${problem.functionName}(${args.map((a) => JSON.stringify(a)).join(', ')})`;
}

/** Runs JavaScript code against every test in a Web Worker with a per-test time limit. */
function runTests(problem, code) {
  return new Promise((resolve) => {
    const worker = new Worker('/js/code-runner.worker.js');
    const results = problem.tests.map(() => null);
    let running = -1;
    let timer = null;

    const finish = (extra = {}) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ results, logs: [], ...extra });
    };
    const onTimeout = () => {
      const seconds = TEST_TIME_LIMIT_MS / 1000;
      if (running >= 0) {
        results[running] = {
          pass: false,
          error: `Time limit exceeded (${seconds} s). Look for an infinite loop or a slow (exponential) approach.`,
        };
        finish({ timedOut: true });
      } else {
        finish({ error: `Your code did not finish loading within ${seconds} s. Check for an infinite loop outside the function.` });
      }
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, TEST_TIME_LIMIT_MS);
    };

    worker.onmessage = ({ data }) => {
      if (data.type === 'start') {
        running = data.index;
        arm();
      } else if (data.type === 'result') {
        results[data.index] = data;
        running = -1;
      } else if (data.type === 'error') {
        finish({ error: data.message, logs: data.logs });
      } else if (data.type === 'done') {
        finish({ logs: data.logs });
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish({ error: event.message || 'The code could not run.' });
    };

    arm();
    worker.postMessage({ code, functionName: problem.functionName, tests: problem.tests });
  });
}

function recordRun(problem, passed, total) {
  const progress = getCodingProgress();
  const entry = progress[problem.id] ?? { solved: false, attempts: 0, bestPassed: 0 };
  entry.attempts += 1;
  entry.total = total;
  entry.bestPassed = Math.max(entry.bestPassed, passed);
  entry.solved = entry.solved || passed === total;
  entry.lastRun = new Date().toISOString();
  progress[problem.id] = entry;
  save('coding', progress);
}

function renderRunResult(problem, outcome) {
  const out = clear($('coding-results'));
  if (outcome.error) {
    out.append(h('div', { class: 'alert', role: 'alert' }, outcome.error));
  }

  const done = outcome.results.filter(Boolean);
  const passed = done.filter((r) => r.pass).length;
  const total = problem.tests.length;

  out.append(
    h('div', { class: `card run-summary ${passed === total ? 'all-pass' : ''}` },
      h('h3', { tabindex: '-1' }, passed === total ? `All ${total} tests passed ✓` : `${passed} of ${total} tests passed`),
      h('ol', { class: 'test-list' },
        problem.tests.map((test, i) => {
          const r = outcome.results[i];
          const status = !r ? 'Not run' : r.pass ? 'Passed' : 'Failed';
          return h('li', { class: `test-item ${!r ? 'not-run' : r.pass ? 'is-correct' : 'is-wrong'}` },
            h('p', { class: 'review-verdict' }, `${!r ? '•' : r.pass ? '✓' : '✗'} Test ${i + 1}: ${status}`, r?.ms !== undefined ? h('span', { class: 'muted' }, `${r.ms} ms`) : null),
            h('code', { class: 'test-call' }, call(problem, test.args)),
            h('p', {}, h('strong', {}, 'Expected: '), h('code', {}, JSON.stringify(test.expected))),
            r && !r.pass && (r.error
              ? h('p', { class: 'error-text' }, r.error)
              : h('p', {}, h('strong', {}, 'Got: '), h('code', {}, r.actual))),
          );
        }),
      ),
      outcome.logs?.length > 0 && h('details', {},
        h('summary', {}, `Console output (${outcome.logs.length} line${outcome.logs.length === 1 ? '' : 's'})`),
        h('pre', { class: 'console' }, outcome.logs.join('\n')),
      ),
    ),
  );
  out.querySelector('h3').focus();
  return { passed, total };
}

function renderReview(review) {
  const executedNote = review.executed
    ? `Code was run: ${review.testSummary.passed} of ${review.testSummary.total} tests passed. Review by Gemini.`
    : 'AI review by Gemini. This code was NOT executed; the review is based on reasoning only.';
  const verdictClass = review.verdict === 'Looks correct' ? 'level-good' : review.verdict === 'Has bugs' ? 'level-low' : 'level-mid';
  const section = (title, items) => items.length > 0 && h('div', {}, h('h4', {}, title), h('ul', {}, items.map((t) => h('li', {}, t))));

  clear($('coding-review')).append(
    h('div', { class: 'card' },
      h('h3', { tabindex: '-1' }, 'Code review: ', h('span', { class: `score-label ${verdictClass}` }, review.verdict)),
      h('p', { class: 'muted' }, executedNote),
      h('p', {}, review.summary),
      h('p', {}, h('strong', {}, 'Time: '), review.timeComplexity || '—', ' · ', h('strong', {}, 'Space: '), review.spaceComplexity || '—'),
      section('Issues', review.issues),
      section('Edge cases to check', review.edgeCases),
      section('How to improve', review.improvements),
    ),
  );
  $('coding-review').querySelector('h3').focus();
}

async function onRun() {
  const problem = currentProblem();
  const code = $('code-editor').value;
  const button = $('coding-run');
  button.disabled = true;
  $('coding-status').textContent = 'Running tests…';
  clear($('coding-review'));

  const outcome = await runTests(problem, code);
  const { passed, total } = renderRunResult(problem, outcome);
  lastRun = { problemId: problem.id, language, code, passed, total };
  recordRun(problem, passed, total);
  renderList();
  $('coding-status').textContent = `${passed} of ${total} tests passed.`;
  button.disabled = false;
}

async function onReview() {
  const problem = currentProblem();
  const code = $('code-editor').value.trim();
  const button = $('coding-review-btn');
  const status = $('coding-status');

  if (code.length < 10 || code === starterCode(problem, language).trim()) {
    status.textContent = 'Write your solution first, then ask for a review.';
    return;
  }

  const sameAsRun = lastRun && lastRun.problemId === problem.id && lastRun.language === language && lastRun.code.trim() === code;
  button.disabled = true;
  status.textContent = 'Gemini is reviewing your code…';
  try {
    const review = await api('/api/coding/review', {
      method: 'POST',
      body: {
        problemId: problem.id,
        language,
        code,
        testSummary: sameAsRun ? { passed: lastRun.passed, total: lastRun.total } : undefined,
      },
    });
    status.textContent = 'Review ready.';
    renderReview(review);
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

function onEditorKey(event) {
  const editor = event.target;
  if (event.key === 'Escape') {
    editor.dataset.escape = '1';
    return;
  }
  if (event.key === 'Tab' && !event.shiftKey && editor.dataset.escape !== '1') {
    event.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    storeCode(currentProblem(), language, editor.value);
  }
  delete editor.dataset.escape;
}

function currentProblem() {
  return problems.find((p) => p.id === currentId) ?? problems[0];
}

function renderWorkspace() {
  const problem = currentProblem();
  const isJs = language === 'javascript';

  const select = h('select', { id: 'coding-language' },
    Object.entries(LANGUAGE_NAMES).map(([value, name]) => h('option', { value, selected: value === language }, name)));
  select.addEventListener('change', () => {
    language = select.value;
    renderWorkspace();
  });

  const editor = h('textarea', {
    id: 'code-editor',
    class: 'code-editor',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    wrap: 'off',
    maxlength: '8000',
    'aria-describedby': 'code-editor-hint',
  });
  editor.value = savedCode(problem, language);
  editor.addEventListener('input', () => storeCode(problem, language, editor.value));
  editor.addEventListener('keydown', onEditorKey);

  const reset = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Reset code');
  reset.addEventListener('click', () => {
    editor.value = starterCode(problem, language);
    storeCode(problem, language, editor.value);
    editor.focus();
  });

  clear($('coding-workspace')).append(
    h('div', { class: 'card' },
      h('h2', {}, problem.title),
      h('p', {}, h('span', { class: 'tag' }, problem.difficulty), ' ', h('span', { class: 'tag' }, problem.topic)),
      h('p', {}, problem.statement),
      h('h3', {}, 'Examples'),
      h('ul', { class: 'examples' },
        problem.tests.slice(0, 2).map((t) => h('li', {}, h('code', {}, `${call(problem, t.args)} → ${JSON.stringify(t.expected)}`)))),
      h('div', { class: 'field' }, h('label', { for: 'coding-language' }, 'Language'), select),
      h('p', { class: 'hint' }, isJs
        ? `Your JavaScript runs against ${problem.tests.length} real test cases in your browser.`
        : `${LANGUAGE_NAMES[language]} cannot run in the browser: use "AI review" to get feedback from Gemini (not executed).`),
      h('div', { class: 'field' },
        h('label', { for: 'code-editor' }, 'Your code'),
        editor,
        h('p', { class: 'hint', id: 'code-editor-hint' }, 'Tab inserts spaces. Press Esc, then Tab, to move out of the editor. Your code is saved in this browser.'),
      ),
      h('div', { class: 'btn-row' },
        isJs && h('button', { class: 'btn', id: 'coding-run', type: 'button', onClick: onRun }, 'Run tests'),
        h('button', { class: `btn ${isJs ? 'btn-secondary' : ''}`, id: 'coding-review-btn', type: 'button', onClick: onReview }, 'AI review'),
        reset,
      ),
      h('p', { class: 'status', id: 'coding-status', role: 'status', 'aria-live': 'polite' }),
    ),
    h('div', { id: 'coding-results' }),
    h('div', { id: 'coding-review' }),
  );
}

function renderList() {
  const progress = getCodingProgress();
  const solved = problems.filter((p) => progress[p.id]?.solved).length;
  clear($('coding-list')).append(
    h('p', { class: 'muted' }, `${solved} of ${problems.length} solved`),
    h('ul', {},
      problems.map((p) => {
        const button = h('button', {
          type: 'button',
          class: 'problem-button',
          'aria-current': p.id === currentId ? 'true' : null,
        },
        h('span', {}, progress[p.id]?.solved ? '✓ ' : '', p.title),
        h('span', { class: 'muted small' }, p.difficulty));
        button.addEventListener('click', () => {
          currentId = p.id;
          lastRun = null;
          renderList();
          renderWorkspace();
          $('coding-workspace').querySelector('h2').setAttribute('tabindex', '-1');
          $('coding-workspace').querySelector('h2').focus();
        });
        return h('li', {}, button);
      }),
    ),
  );
}

export async function render() {
  if (problems) {
    renderList();
    return;
  }
  $('coding-workspace').append(h('p', { class: 'status', role: 'status' }, 'Loading problems…'));
  try {
    problems = (await api('/api/coding/problems')).problems;
  } catch (err) {
    clear($('coding-workspace')).append(h('div', { class: 'alert', role: 'alert' }, err.message));
    return;
  }
  save('codingTotal', problems.length);
  currentId = problems[0].id;
  renderList();
  renderWorkspace();
}
