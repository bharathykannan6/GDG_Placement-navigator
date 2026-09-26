import { api } from './api.js';
import { h, clear } from './dom.js';
import { load, save } from './store.js';
import { getProfile } from './profile.js';
import { bar } from './standing.js';
import { analyseAnswer, formatDuration } from './speech-stats.js';

const SCORE_LABELS = { relevance: 'Relevance', structure: 'Structure', clarity: 'Clarity', depth: 'Depth' };

let current = null; // { question, tip, round, targetRole }
const asked = [];
let recognition = null;
let listening = false;

const $ = (id) => document.getElementById(id);

export function getInterviews() {
  return load('interviews', []);
}

function describe(analysis) {
  const parts = [
    `${analysis.words} words`,
    `about ${formatDuration(analysis.seconds)} spoken`,
    `filler words: ${analysis.fillerTotal}`,
  ];
  const detail = Object.entries(analysis.fillers).map(([word, n]) => `"${word}" ×${n}`).join(', ');
  return parts.join(' · ') + (detail ? ` (${detail})` : '');
}

function updateStats() {
  $('iv-stats').textContent = describe(analyseAnswer($('iv-answer').value));
}

function setListening(on) {
  listening = on;
  $('iv-speak').setAttribute('aria-pressed', String(on));
  $('iv-speak').textContent = on ? 'Stop speaking' : 'Speak your answer';
}

function setupSpeech() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return; // typing still works everywhere

  recognition = new Recognition();
  recognition.lang = 'en-IN';
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.addEventListener('result', (event) => {
    const box = $('iv-answer');
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (!event.results[i].isFinal) continue;
      const spoken = event.results[i][0].transcript.trim();
      box.value = box.value ? `${box.value.trimEnd()} ${spoken}` : spoken;
    }
    updateStats();
  });
  recognition.addEventListener('end', () => setListening(false));
  recognition.addEventListener('error', (event) => {
    $('iv-status').textContent = `Voice input stopped (${event.error}). You can keep typing.`;
    setListening(false);
  });

  $('iv-speak').hidden = false;
  $('iv-speech-note').hidden = false;
  $('iv-speak').addEventListener('click', () => {
    if (listening) {
      recognition.stop();
      return;
    }
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  });
}

async function nextQuestion() {
  const button = $('iv-next');
  const status = $('iv-status');
  const targetRole = $('iv-role').value.trim();
  const round = $('iv-round').value;

  if (targetRole.length < 2) {
    status.textContent = 'Enter the role you are preparing for.';
    $('iv-role').focus();
    return;
  }
  if (listening) recognition.stop();

  button.disabled = true;
  status.textContent = 'Getting a question…';
  try {
    const data = await api('/api/interview/question', {
      method: 'POST',
      body: { targetRole, round, asked: asked.slice(-10) },
    });
    current = { ...data, round, targetRole };
    asked.push(data.question);

    $('iv-round-tag').textContent = `${round} round`;
    $('iv-question-text').textContent = data.question;
    $('iv-tip').textContent = data.tip || 'Answer in 1–2 minutes with one concrete example.';
    $('iv-answer').value = '';
    updateStats();
    clear($('iv-result'));
    $('iv-question').hidden = false;
    button.textContent = 'Next question';
    status.textContent = '';
    $('iv-question-text').focus();
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

function renderFeedback(fb, analysis) {
  const out = clear($('iv-result'));
  out.append(
    h('div', { class: 'card' },
      h('h2', { tabindex: '-1' }, `Feedback: ${fb.overall} / 5`),
      h('div', { class: 'bars' },
        Object.entries(fb.scores).map(([key, value]) => h('div', { class: 'bar-row' },
          h('div', { class: 'bar-label' }, h('span', {}, SCORE_LABELS[key] ?? key), h('span', { class: 'bar-value' }, `${value}/5`)),
          bar(value * 20),
        )),
      ),
      h('p', { class: 'muted delivery' }, `Delivery: ${describe(analysis)}.`,
        analysis.fillerRate >= 5 ? ' Try pausing silently instead of using filler words.' : ''),
    ),
    h('div', { class: 'card feedback-grid' },
      h('div', {}, h('h3', {}, 'What worked'), h('ul', {}, fb.whatWorked.map((t) => h('li', {}, t)))),
      h('div', {}, h('h3', {}, 'Improve next time'), h('ul', {}, fb.improve.map((t) => h('li', {}, t)))),
    ),
    fb.betterAnswer && h('div', { class: 'card' },
      h('h3', {}, 'A stronger version of your answer'),
      h('blockquote', {}, fb.betterAnswer),
    ),
  );
  out.querySelector('h2').focus();
}

async function getFeedback() {
  const button = $('iv-feedback');
  const status = $('iv-status');
  const answer = $('iv-answer').value.trim();

  if (!current) return;
  if (answer.length < 20) {
    status.textContent = 'Write or speak at least a couple of sentences first.';
    $('iv-answer').focus();
    return;
  }
  if (listening) recognition.stop();

  const analysis = analyseAnswer(answer);
  button.disabled = true;
  status.textContent = 'Evaluating your answer…';
  try {
    const fb = await api('/api/interview/feedback', {
      method: 'POST',
      body: { question: current.question, answer, round: current.round, targetRole: current.targetRole },
    });
    const history = getInterviews();
    history.push({
      date: new Date().toISOString(),
      round: current.round,
      question: current.question,
      scores: fb.scores,
      overall: fb.overall,
      words: analysis.words,
      fillerTotal: analysis.fillerTotal,
    });
    save('interviews', history.slice(-50));
    status.textContent = '';
    renderFeedback(fb, analysis);
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

export function init() {
  $('iv-next').addEventListener('click', nextQuestion);
  $('iv-feedback').addEventListener('click', getFeedback);
  $('iv-answer').addEventListener('input', updateStats);
  setupSpeech();
}

export function render() {
  const profile = getProfile();
  if (profile && !$('iv-role').value) $('iv-role').value = profile.targetRole;
}
