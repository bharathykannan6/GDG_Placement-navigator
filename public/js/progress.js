import { h, clear } from './dom.js';
import { clearAll, load } from './store.js';
import { go } from './router.js';
import { bar } from './standing.js';
import { getAttempts } from './diagnostic.js';
import { getSavedPlan } from './plan.js';
import { getResumeHistory } from './resume.js';
import { getInterviews } from './interview.js';
import { getCodingProgress } from './coding.js';
import { attemptDeltas, interviewSummary, planCompletion, signed } from './progress-stats.js';

const root = () => document.getElementById('progress-root');

function delta(n) {
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'same';
  const arrow = n > 0 ? '▲' : n < 0 ? '▼' : '■';
  return h('span', { class: `delta ${cls}` }, `${arrow} ${signed(n)}`);
}

function diagnosticCard(attempts) {
  if (!attempts.length) {
    return h('div', { class: 'card' },
      h('h2', {}, 'Diagnostic'),
      h('p', { class: 'muted' }, 'No attempts yet.'),
      h('a', { class: 'btn', href: '#diagnostic' }, 'Take the diagnostic'));
  }

  const areas = Object.keys(attempts[0].byArea);
  const deltas = attemptDeltas(attempts);

  return h('div', { class: 'card' },
    h('h2', {}, 'Diagnostic'),
    deltas
      ? h('div', { class: 'delta-row' },
          h('p', {}, h('strong', {}, 'Since last attempt: '), 'Overall ', delta(deltas.overall)),
          h('ul', { class: 'delta-list' }, areas.map((area) => h('li', {}, `${area} `, delta(deltas.byArea[area])))))
      : h('p', { class: 'muted' }, 'Retake the diagnostic after a week of practice to see your change.'),
    h('div', { class: 'table-scroll' },
      h('table', {},
        h('caption', { class: 'visually-hidden' }, 'Diagnostic attempts, newest first'),
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, 'Date'),
          h('th', { scope: 'col' }, 'Overall'),
          areas.map((area) => h('th', { scope: 'col' }, area)))),
        h('tbody', {}, [...attempts].reverse().map((a) => h('tr', {},
          h('td', {}, new Date(a.date).toLocaleDateString()),
          h('td', {}, h('strong', {}, `${a.overall}%`)),
          areas.map((area) => h('td', {}, `${a.byArea[area]?.percent ?? 0}%`))))),
      ),
    ),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-secondary', href: '#diagnostic' }, 'Retake diagnostic')),
  );
}

function interviewCard(interviews) {
  const summary = interviewSummary(interviews);
  return h('div', { class: 'card' },
    h('h2', {}, 'Mock interviews'),
    summary.total === 0
      ? [h('p', { class: 'muted' }, 'No answers yet.'), h('a', { class: 'btn', href: '#interview' }, 'Practise a question')]
      : [
          h('p', { class: 'muted' }, `${summary.total} answer${summary.total === 1 ? '' : 's'} practised. Averages use your last 5 answers per round.`),
          h('div', { class: 'bars' },
            Object.entries(summary.rounds).map(([round, s]) => h('div', { class: 'bar-row' },
              h('div', { class: 'bar-label' },
                h('span', {}, `${round} round`),
                h('span', { class: 'bar-value' }, s ? `${s.average}/5 · ${s.fillersPerAnswer} filler words per answer` : 'not practised yet')),
              bar(s ? s.average * 20 : 0),
            ))),
        ],
  );
}

function codingCard(progress, total) {
  const entries = Object.values(progress);
  if (!entries.length) {
    return h('div', { class: 'card' },
      h('h2', {}, 'Coding practice'),
      h('p', { class: 'muted' }, 'No problems attempted yet.'),
      h('a', { class: 'btn', href: '#coding' }, 'Start coding practice'));
  }
  const solved = entries.filter((e) => e.solved).length;
  const attempts = entries.reduce((n, e) => n + e.attempts, 0);
  const outOf = total ?? entries.length;
  return h('div', { class: 'card' },
    h('h2', {}, 'Coding practice'),
    h('p', {}, `${solved} of ${outOf} problems solved (all tests passing) · ${attempts} test runs`),
    bar(outOf ? Math.round((solved / outOf) * 100) : 0),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-secondary', href: '#coding' }, 'Open coding practice')),
  );
}

function resumeCard(history) {
  if (!history.length) return null;
  const latest = history[history.length - 1];
  const prev = history.length > 1 ? history[history.length - 2] : null;
  return h('div', { class: 'card' },
    h('h2', {}, 'Resume match'),
    h('p', {}, h('strong', {}, `${latest.matchScore}%`), ` for ${latest.targetRole} `,
      prev ? delta(latest.matchScore - prev.matchScore) : null),
    bar(latest.matchScore),
  );
}

function planCard(saved) {
  const completion = planCompletion(saved);
  if (!completion) return null;
  return h('div', { class: 'card' },
    h('h2', {}, 'Plan completion'),
    h('p', {}, `${completion.done} of ${completion.total} tasks done (${completion.percent}%)`),
    bar(completion.percent),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-secondary', href: '#plan' }, 'Open plan')),
  );
}

function clearData() {
  // eslint-disable-next-line no-alert
  if (!window.confirm('Delete your profile, results, plan and interview history from this browser?')) return;
  clearAll();
  go('home');
}

export function render() {
  const el = clear(root());
  el.append(
    diagnosticCard(getAttempts()),
    ...[
      planCard(getSavedPlan()),
      codingCard(getCodingProgress(), load('codingTotal', null)),
      interviewCard(getInterviews()),
      resumeCard(getResumeHistory()),
    ].filter(Boolean),
    h('div', { class: 'card' },
      h('h2', {}, 'Your data'),
      h('p', { class: 'muted' }, 'Everything is stored only in this browser. Clearing it cannot be undone.'),
      h('button', { class: 'btn btn-danger', type: 'button', onClick: clearData }, 'Clear my data'),
    ),
  );
}
