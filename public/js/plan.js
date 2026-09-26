import { api } from './api.js';
import { h, clear } from './dom.js';
import { load, save } from './store.js';
import { getProfile } from './profile.js';
import { latestAttempt } from './diagnostic.js';

const root = () => document.getElementById('plan-root');
const RESOURCE_LABEL = { practice: 'Practice', video: 'Video', notes: 'Notes', mock: 'Mock test' };

export function getSavedPlan() {
  return load('plan', null);
}

function taskKey(week, i) {
  return `w${week}-t${i}`;
}

function missingStep(profile, attempt) {
  if (!profile) return { text: 'Fill in your profile first so the plan fits your role and time.', href: '#profile', label: 'Go to profile' };
  if (!attempt) return { text: 'Take the diagnostic first so the plan targets your weak areas.', href: '#diagnostic', label: 'Take the diagnostic' };
  return null;
}

async function generate(button, status) {
  const profile = getProfile();
  const attempt = latestAttempt();
  button.disabled = true;
  status.textContent = 'Building your plan… this can take up to 20 seconds.';

  try {
    const plan = await api('/api/plan', {
      method: 'POST',
      body: {
        profile,
        scores: { overall: attempt.overall, byArea: attempt.byArea },
      },
    });
    save('plan', { createdAt: new Date().toISOString(), basedOn: attempt.date, plan, done: {} });
    render();
  } catch (err) {
    status.textContent = '';
    status.append(h('span', { class: 'error-text' }, err.message));
    button.disabled = false;
  }
}

function toggleTask(key, checked) {
  const saved = getSavedPlan();
  if (!saved) return;
  saved.done[key] = checked;
  save('plan', saved);
}

function renderPlan(saved, stale) {
  const { plan, done } = saved;
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const regen = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Regenerate plan');
  regen.addEventListener('click', () => generate(regen, status));

  return [
    stale && h('div', { class: 'card notice' },
      'You have a newer diagnostic result than this plan. Regenerate to update it.'),
    h('div', { class: 'card' },
      h('h2', {}, 'Your strategy'),
      h('p', {}, plan.summary),
      h('p', { class: 'muted' },
        `About ${plan.weeksLeft} week${plan.weeksLeft === 1 ? '' : 's'} until placement drives · plan made ${new Date(saved.createdAt).toLocaleDateString()}`),
      h('div', { class: 'daily-habit' }, h('strong', {}, 'Daily habit: '), plan.dailyHabit),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'What to prepare first'),
      h('ol', { class: 'priority-list' },
        plan.priorities.map((p) => h('li', {},
          h('h3', {}, p.area),
          h('p', { class: 'muted' }, p.why),
          h('ul', {}, p.actions.map((a) => h('li', {}, a))),
        )),
      ),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'How to prepare: week by week'),
      h('p', { class: 'muted' }, 'Tick tasks as you finish them. Progress is saved in this browser.'),
      plan.weeklyPlan.map((w) => h('fieldset', { class: 'week' },
        h('legend', {}, `Week ${w.week}: ${w.focus}`),
        w.tasks.map((task, i) => {
          const key = taskKey(w.week, i);
          const id = `task-${key}`;
          return h('div', { class: 'check' },
            h('input', {
              type: 'checkbox',
              id,
              checked: Boolean(done[key]),
              onChange: (e) => toggleTask(key, e.target.checked),
            }),
            h('label', { for: id }, task),
          );
        }),
      )),
    ),
    plan.resources.length > 0 && h('div', { class: 'card' },
      h('h2', {}, 'Suggested practice'),
      h('ul', { class: 'resource-list' },
        plan.resources.map((r) => h('li', {},
          h('span', { class: 'tag' }, RESOURCE_LABEL[r.type] ?? r.type),
          ' ',
          h('strong', {}, `${r.area}: `),
          r.suggestion,
        )),
      ),
    ),
    h('div', { class: 'btn-row' }, regen),
    status,
  ];
}

export function render() {
  const el = clear(root());
  const profile = getProfile();
  const attempt = latestAttempt();
  const missing = missingStep(profile, attempt);

  if (missing) {
    el.append(h('div', { class: 'card' },
      h('p', {}, missing.text),
      h('a', { class: 'btn', href: missing.href }, missing.label),
    ));
    return;
  }

  const saved = getSavedPlan();
  if (saved?.plan) {
    el.append(...renderPlan(saved, saved.basedOn !== attempt.date).filter(Boolean));
    return;
  }

  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const button = h('button', { class: 'btn', type: 'button' }, 'Generate my plan');
  button.addEventListener('click', () => generate(button, status));

  el.append(h('div', { class: 'card' },
    h('h2', {}, 'Your personal prep plan'),
    h('p', { class: 'muted' },
      `Based on your latest score (${attempt.overall}%), your target role (${profile.targetRole}) and `,
      `${profile.hoursPerWeek} hours a week. Your name is not sent to the AI.`),
    h('div', { class: 'btn-row' }, button),
    status,
  ));
}
