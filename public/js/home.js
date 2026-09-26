import { h, clear } from './dom.js';
import { getProfile } from './profile.js';
import { latestAttempt } from './diagnostic.js';
import { getSavedPlan } from './plan.js';
import { getInterviews } from './interview.js';
import { readinessLabel } from './standing.js';

/** The single most useful next action for this student. */
function nextStep(profile, attempt, plan, interviews) {
  if (!profile) return { text: 'Start by telling us your branch, target role and time available.', href: '#profile', label: 'Start with your profile' };
  if (!attempt) return { text: 'Take the 10-minute diagnostic to see where you stand.', href: '#diagnostic', label: 'Take the diagnostic' };
  if (!plan) return { text: 'Turn your results into a week-by-week plan.', href: '#plan', label: 'Get my prep plan' };
  if (!interviews.length) return { text: 'Practise speaking: answer one mock interview question.', href: '#interview', label: 'Start a mock interview' };
  return { text: 'Keep going: tick off this week\'s tasks and practise another question.', href: '#plan', label: 'Open my plan' };
}

export function render() {
  const el = clear(document.getElementById('home-next'));
  const profile = getProfile();
  const attempt = latestAttempt();
  const step = nextStep(profile, attempt, getSavedPlan(), getInterviews());

  el.append(h('div', { class: 'card next-card' },
    profile && h('p', { class: 'welcome' }, `Welcome back, ${profile.name}.`),
    attempt && h('p', {}, 'Current readiness: ', h('strong', {}, `${attempt.overall}% (${readinessLabel(attempt.overall)})`)),
    h('p', { class: 'muted' }, step.text),
    h('a', { class: 'btn', href: step.href }, step.label),
  ));
}
