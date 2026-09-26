import { api } from './api.js';
import { h, clear } from './dom.js';
import { load, save } from './store.js';
import { getProfile } from './profile.js';
import { latestAttempt } from './diagnostic.js';
import { getSavedPlan } from './plan.js';
import { getCodingProgress } from './coding.js';
import { getInterviews } from './interview.js';
import { getResumeHistory } from './resume.js';
import { interviewSummary } from './progress-stats.js';

const MAX_SENT = 12;
const MAX_STORED = 30;
const STARTERS = [
  'What should I focus on this week?',
  'How do I explain my project in an interview?',
  'Give me a 1-hour study plan for today.',
  'How do I stay consistent with preparation?',
];

let sending = false;
const $ = (id) => document.getElementById(id);

function getChat() {
  return load('mentorChat', []);
}

/** Everything the mentor should know, built from this browser's data. The name is never sent. */
export function buildContext() {
  const profile = getProfile();
  const attempt = latestAttempt();
  const plan = getSavedPlan()?.plan;
  const coding = Object.values(getCodingProgress());
  const interviews = interviewSummary(getInterviews());
  const averages = Object.values(interviews.rounds).filter(Boolean).map((r) => r.average);
  const resume = getResumeHistory().at(-1);

  const context = {};
  if (profile) {
    Object.assign(context, {
      branch: profile.branch,
      year: profile.year,
      targetRole: profile.targetRole,
      companyType: profile.companyType,
      hoursPerWeek: profile.hoursPerWeek,
      driveMonth: profile.driveMonth,
    });
  }
  if (attempt) {
    context.overallScore = attempt.overall;
    context.areaScores = Object.fromEntries(Object.entries(attempt.byArea).map(([area, s]) => [area, s.percent]));
  }
  if (plan) {
    context.planSummary = plan.summary.slice(0, 800);
    context.planFocus = plan.weeklyPlan.map((w) => `Week ${w.week}: ${w.focus}`.slice(0, 120)).slice(0, 8);
  }
  if (coding.length) {
    context.codingSolved = coding.filter((c) => c.solved).length;
    const total = load('codingTotal', null);
    if (total) context.codingTotal = total;
  }
  if (averages.length) context.interviewAverage = Math.round((averages.reduce((a, b) => a + b, 0) / averages.length) * 10) / 10;
  if (resume) context.resumeMatch = resume.matchScore;
  return context;
}

function bubble(message) {
  const mine = message.role === 'user';
  return h('div', { class: `bubble ${mine ? 'from-user' : 'from-mentor'}` },
    h('span', { class: 'bubble-who' }, mine ? 'You' : 'Mentor'),
    h('p', { class: 'bubble-text' }, message.text),
  );
}

function chips(questions) {
  if (!questions.length) return null;
  return h('div', { class: 'chips', role: 'group', 'aria-label': 'Suggested questions' },
    questions.map((q) => h('button', { class: 'chip', type: 'button', onClick: () => send(q) }, q)));
}

function renderLog() {
  const chat = getChat();
  const log = clear($('mentor-log'));
  if (!chat.length) {
    log.append(h('div', { class: 'bubble from-mentor' },
      h('span', { class: 'bubble-who' }, 'Mentor'),
      h('p', { class: 'bubble-text' },
        'Hi! I know your profile, diagnostic scores, plan and practice results in this app, so ask me anything about your placement preparation.'),
    ));
  } else {
    log.append(...chat.map(bubble));
  }
  const last = chat.at(-1);
  const suggestions = !chat.length ? STARTERS : last?.role === 'model' ? last.followUps ?? [] : [];
  clear($('mentor-suggestions')).append(chips(suggestions) ?? '');
  log.scrollTop = log.scrollHeight;
}

async function send(textValue) {
  const question = textValue.trim();
  const status = $('mentor-status');
  if (!question || sending) return;
  if (question.length > 2000) {
    status.textContent = 'Please keep your question under 2000 characters.';
    return;
  }

  sending = true;
  $('mentor-send').disabled = true;
  const chat = getChat();
  chat.push({ role: 'user', text: question });
  save('mentorChat', chat.slice(-MAX_STORED));
  $('mentor-input').value = '';
  renderLog();
  status.textContent = 'Mentor is thinking…';

  // Send the most recent turns; the conversation must start with a user message.
  let recent = chat.slice(-MAX_SENT).map(({ role, text }) => ({ role, text }));
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);

  try {
    const data = await api('/api/mentor/chat', { method: 'POST', body: { messages: recent, context: buildContext() } });
    chat.push({ role: 'model', text: data.reply, followUps: data.followUps });
    save('mentorChat', chat.slice(-MAX_STORED));
    status.textContent = '';
  } catch (err) {
    chat.pop(); // let the student retry the same question
    save('mentorChat', chat.slice(-MAX_STORED));
    $('mentor-input').value = question;
    status.textContent = err.message;
  } finally {
    sending = false;
    $('mentor-send').disabled = false;
    renderLog();
  }
}

export function init() {
  $('mentor-form').addEventListener('submit', (event) => {
    event.preventDefault();
    send($('mentor-input').value);
  });
  $('mentor-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send($('mentor-input').value);
    }
  });
  $('mentor-clear').addEventListener('click', () => {
    save('mentorChat', []);
    $('mentor-status').textContent = 'Chat cleared.';
    renderLog();
  });
}

export function render() {
  renderLog();
}
