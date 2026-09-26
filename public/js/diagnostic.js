import { api } from './api.js';
import { h, clear } from './dom.js';
import { load, save } from './store.js';
import { go } from './router.js';

const MAX_ATTEMPTS = 20;

let questions = null;
let answers = {};
let index = 0;
let confirmUnanswered = false;

const root = () => document.getElementById('diag-root');

export function getAttempts() {
  return load('attempts', []);
}

export function latestAttempt() {
  const attempts = getAttempts();
  return attempts.length ? attempts[attempts.length - 1] : null;
}

async function loadQuestions() {
  if (questions) return questions;
  const data = await api('/api/diagnostic/questions');
  questions = data.questions;
  return questions;
}

function showError(message) {
  clear(root()).append(
    h('div', { class: 'alert', role: 'alert' }, message),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onClick: render }, 'Try again')),
  );
}

function renderIntro() {
  const last = latestAttempt();
  clear(root()).append(
    h('div', { class: 'card' },
      h('h2', {}, last ? 'Retake the diagnostic' : 'Find out where you stand'),
      h('p', { class: 'muted' },
        '20 multiple-choice questions, 5 each in Aptitude, DSA, CS Fundamentals and Communication. ',
        'It takes about 10 minutes. Answer honestly and skip anything you don\'t know.'),
      last && h('p', {}, `Your last score: ${last.overall}% on ${new Date(last.date).toLocaleDateString()}.`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onClick: startQuiz }, last ? 'Start again' : 'Start diagnostic')),
    ),
  );
}

async function startQuiz() {
  clear(root()).append(h('p', { class: 'status', role: 'status' }, 'Loading questions…'));
  try {
    await loadQuestions();
  } catch (err) {
    showError(err.message);
    return;
  }
  answers = {};
  index = 0;
  confirmUnanswered = false;
  renderQuestion();
}

function renderQuestion() {
  const q = questions[index];
  const total = questions.length;
  const isLast = index === total - 1;
  const status = h('p', { class: 'status', role: 'status' });

  const options = q.options.map((option, i) => {
    const id = `${q.id}-opt-${i}`;
    return h('div', { class: 'option' },
      h('input', {
        type: 'radio',
        name: q.id,
        id,
        value: i,
        checked: answers[q.id] === i,
        onChange: () => {
          answers[q.id] = i;
          confirmUnanswered = false;
        },
      }),
      h('label', { for: id }, option),
    );
  });

  const card = h('div', { class: 'card quiz-card' },
    h('div', { class: 'quiz-meta' },
      h('span', { class: 'tag' }, q.area),
      h('span', { class: 'muted' }, `Question ${index + 1} of ${total}`),
    ),
    h('progress', { max: total, value: index + 1, 'aria-label': 'Diagnostic progress' }),
    h('fieldset', {},
      h('legend', {}, q.question),
      options,
    ),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-secondary', type: 'button', disabled: index === 0, onClick: () => move(-1) }, 'Previous'),
      isLast
        ? h('button', { class: 'btn', type: 'button', onClick: () => submit(status) }, 'Submit answers')
        : h('button', { class: 'btn', type: 'button', onClick: () => move(1) }, 'Next'),
    ),
    status,
  );

  clear(root()).append(card);
  card.querySelector('legend').setAttribute('tabindex', '-1');
  card.querySelector('legend').focus();
}

function move(step) {
  index = Math.min(Math.max(index + step, 0), questions.length - 1);
  renderQuestion();
}

async function submit(status) {
  const unanswered = questions.filter((q) => answers[q.id] === undefined).length;
  if (unanswered && !confirmUnanswered) {
    confirmUnanswered = true;
    status.textContent = `${unanswered} question${unanswered > 1 ? 's are' : ' is'} unanswered and will count as wrong. Press "Submit answers" again to finish.`;
    return;
  }

  status.textContent = 'Scoring…';
  let result;
  try {
    result = await api('/api/diagnostic/score', { method: 'POST', body: { answers } });
  } catch (err) {
    status.textContent = err.message;
    return;
  }

  const attempts = getAttempts();
  attempts.push({ date: new Date().toISOString(), ...result });
  save('attempts', attempts.slice(-MAX_ATTEMPTS));
  renderIntro();
  go('standing');
}

export function render() {
  if (root().querySelector('.quiz-card')) return; // keep an in-progress quiz
  renderIntro();
}
