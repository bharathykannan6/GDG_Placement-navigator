import { h, clear } from './dom.js';
import { latestAttempt } from './diagnostic.js';

const root = () => document.getElementById('standing-root');

export function readinessLabel(percent) {
  if (percent >= 70) return 'Placement ready';
  if (percent >= 40) return 'Building up';
  return 'Getting started';
}

function levelClass(percent) {
  if (percent >= 70) return 'level-good';
  if (percent >= 40) return 'level-mid';
  return 'level-low';
}

/** Strongest and weakest area; ties go to the area listed first. */
export function extremes(byArea) {
  const entries = Object.entries(byArea);
  let strongest = entries[0];
  let weakest = entries[0];
  for (const entry of entries) {
    if (entry[1].percent > strongest[1].percent) strongest = entry;
    if (entry[1].percent < weakest[1].percent) weakest = entry;
  }
  return { strongest: strongest[0], weakest: weakest[0], balanced: strongest[1].percent === weakest[1].percent };
}

export function bar(percent) {
  const fill = h('div', { class: `bar-fill ${levelClass(percent)}` });
  fill.style.width = `${Math.min(Math.max(percent, 0), 100)}%`; // CSSOM, allowed by the CSP
  return h('div', { class: 'bar-track', role: 'presentation' }, fill);
}

function areaBar(area, stats) {
  return h('div', { class: 'bar-row' },
    h('div', { class: 'bar-label' },
      h('span', {}, area),
      h('span', { class: 'bar-value' }, `${stats.percent}% (${stats.correct}/${stats.total})`),
    ),
    bar(stats.percent),
  );
}

function reviewItem(item) {
  return h('li', { class: `review-item ${item.correct ? 'is-correct' : 'is-wrong'}` },
    h('p', { class: 'review-verdict' }, item.correct ? '✓ Correct' : '✗ Wrong', h('span', { class: 'tag' }, item.area)),
    h('p', { class: 'review-q' }, item.question),
    !item.correct && h('p', {}, h('strong', {}, 'Your answer: '), item.chosen ?? 'Not answered'),
    h('p', {}, h('strong', {}, 'Correct answer: '), item.answer),
    h('p', { class: 'muted' }, item.explanation),
  );
}

export function render() {
  const attempt = latestAttempt();
  const el = clear(root());

  if (!attempt) {
    el.append(h('div', { class: 'card' },
      h('h2', {}, 'No results yet'),
      h('p', { class: 'muted' }, 'Take the 10-minute diagnostic to see where you stand in each area.'),
      h('a', { class: 'btn', href: '#diagnostic' }, 'Take the diagnostic'),
    ));
    return;
  }

  const { strongest, weakest, balanced } = extremes(attempt.byArea);
  const wrong = attempt.review.filter((r) => !r.correct);
  const right = attempt.review.filter((r) => r.correct);

  el.append(
    h('div', { class: 'card score-card' },
      h('div', { class: 'score-main' },
        h('p', { class: 'score-number' }, `${attempt.overall}%`),
        h('div', {},
          h('p', { class: `score-label ${levelClass(attempt.overall)}` }, readinessLabel(attempt.overall)),
          h('p', { class: 'muted' },
            `${attempt.correct} of ${attempt.total} correct · ${new Date(attempt.date).toLocaleString()}`),
        ),
      ),
      h('div', { class: 'bars' }, Object.entries(attempt.byArea).map(([area, stats]) => areaBar(area, stats))),
    ),
    h('div', { class: 'callouts' },
      h('div', { class: 'card callout' },
        h('h2', {}, 'Strongest area'),
        h('p', { class: 'callout-value' }, balanced ? 'All areas level' : strongest),
        h('p', { class: 'muted' }, balanced ? 'Your scores are the same in every area.' : 'Keep it warm with short weekly practice.'),
      ),
      h('div', { class: 'card callout' },
        h('h2', {}, 'Focus first'),
        h('p', { class: 'callout-value' }, balanced ? 'Mixed practice' : weakest),
        h('p', { class: 'muted' }, balanced ? 'Practise all areas evenly.' : 'This area will raise your readiness the most.'),
      ),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Review your answers'),
      h('details', { open: wrong.length > 0 },
        h('summary', {}, `Wrong or skipped (${wrong.length})`),
        h('ol', { class: 'review-list' }, wrong.map(reviewItem)),
      ),
      h('details', {},
        h('summary', {}, `Correct (${right.length})`),
        h('ol', { class: 'review-list' }, right.map(reviewItem)),
      ),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn', href: '#plan' }, 'Get my prep plan'),
        h('a', { class: 'btn btn-secondary', href: '#diagnostic' }, 'Retake diagnostic')),
    ),
  );
}
