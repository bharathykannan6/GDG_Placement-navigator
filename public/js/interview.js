import { api } from './api.js';
import { h, clear } from './dom.js';
import { load, save } from './store.js';
import { getProfile } from './profile.js';
import { bar } from './standing.js';
import { analyseAnswer, formatDuration } from './speech-stats.js';

const SCORE_LABELS = { relevance: 'Relevance', structure: 'Structure', clarity: 'Clarity', depth: 'Depth' };
const SESSION_LENGTH = 5;

let current = null; // { question, tip, round, targetRole }
const asked = [];
let session = null; // { targetRole, roundChoice, items: [], finished }
let recognition = null;
let listening = false;

const $ = (id) => document.getElementById(id);

export function getInterviews() {
  return load('interviews', []);
}

export function getSessions() {
  return load('interviewSessions', []);
}

/** "Mixed" alternates HR and Technical questions. */
export function roundFor(choice, index) {
  if (choice !== 'Mixed') return choice;
  return index % 2 === 0 ? 'HR' : 'Technical';
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

function stopListening() {
  if (listening) recognition.stop();
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

function isSessionMode() {
  return $('iv-mode').value === 'session';
}

/** Updates button labels and visibility for the current mode and progress. */
function syncControls() {
  const next = $('iv-next');
  const reportBtn = $('iv-report');
  reportBtn.hidden = true;
  next.hidden = false;
  next.disabled = false;

  if (!isSessionMode()) {
    next.textContent = current ? 'Next question' : 'Get a question';
    $('iv-progress').textContent = '';
    return;
  }

  if (!session || session.finished) {
    next.textContent = `Start interview (${SESSION_LENGTH} questions)`;
    $('iv-progress').textContent = '';
    return;
  }

  const answered = session.items.length;
  const onQuestion = session.asking ? answered + 1 : answered;
  $('iv-progress').textContent = `Question ${Math.max(onQuestion, 1)} of ${SESSION_LENGTH}`;

  if (answered === SESSION_LENGTH) {
    next.hidden = true;
    reportBtn.hidden = false;
  } else {
    next.textContent = `Next question (${answered + 1} of ${SESSION_LENGTH})`;
    next.disabled = session.asking; // answer the current question first
  }
}

function resetSession(message) {
  session = null;
  current = null;
  $('iv-question').hidden = true;
  clear($('iv-result'));
  $('iv-status').textContent = message ?? '';
  syncControls();
}

async function nextQuestion() {
  const button = $('iv-next');
  const status = $('iv-status');
  const targetRole = $('iv-role').value.trim();
  const choice = $('iv-round').value;

  if (targetRole.length < 2) {
    status.textContent = 'Enter the role you are preparing for.';
    $('iv-role').focus();
    return;
  }
  stopListening();

  if (isSessionMode() && (!session || session.finished)) {
    session = { targetRole, roundChoice: choice, items: [], asking: false, finished: false };
  }
  const index = isSessionMode() ? session.items.length : asked.length;
  const round = roundFor(isSessionMode() ? session.roundChoice : choice, index);

  button.disabled = true;
  status.textContent = 'Getting a question…';
  try {
    const data = await api('/api/interview/question', {
      method: 'POST',
      body: { targetRole, round, asked: asked.slice(-10) },
    });
    current = { ...data, round, targetRole };
    asked.push(data.question);
    if (session) session.asking = true;

    $('iv-round-tag').textContent = `${round} round`;
    $('iv-question-text').textContent = data.question;
    $('iv-tip').textContent = data.tip || 'Answer in 1–2 minutes with one concrete example.';
    $('iv-answer').value = '';
    updateStats();
    clear($('iv-result'));
    $('iv-question').hidden = false;
    $('iv-feedback').disabled = false;
    status.textContent = '';
    $('iv-question-text').focus();
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
    syncControls();
  }
}

function scoreBars(scores) {
  return h('div', { class: 'bars' },
    Object.entries(scores).map(([key, value]) => h('div', { class: 'bar-row' },
      h('div', { class: 'bar-label' }, h('span', {}, SCORE_LABELS[key] ?? key), h('span', { class: 'bar-value' }, `${value}/5`)),
      bar(value * 20),
    )));
}

function renderFeedback(fb, analysis) {
  const out = clear($('iv-result'));
  out.append(
    h('div', { class: 'card' },
      h('h2', { tabindex: '-1' }, `Feedback: ${fb.overall} / 5`),
      scoreBars(fb.scores),
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
  stopListening();

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

    if (session && !session.finished) {
      session.items.push({
        question: current.question,
        answer,
        round: current.round,
        scores: fb.scores,
        overall: fb.overall,
        fillerTotal: analysis.fillerTotal,
      });
      session.asking = false;
      status.textContent = session.items.length === SESSION_LENGTH
        ? 'All questions answered. Open your interview report.'
        : '';
    } else {
      status.textContent = '';
      button.disabled = false;
    }
    renderFeedback(fb, analysis);
  } catch (err) {
    status.textContent = err.message;
    button.disabled = false;
  } finally {
    syncControls();
  }
}

function renderReport(report, items) {
  const fillers = items.reduce((n, it) => n + it.fillerTotal, 0);
  const verdictClass = report.verdict === 'Ready' ? 'level-good' : report.verdict === 'Promising' ? 'level-mid' : 'level-low';
  const list = (title, entries) => entries.length > 0 && h('div', {}, h('h3', {}, title), h('ul', {}, entries.map((t) => h('li', {}, t))));

  $('iv-question').hidden = true;
  clear($('iv-result')).append(
    h('div', { class: 'card report-card' },
      h('h2', { tabindex: '-1' }, 'Interview report'),
      h('div', { class: 'score-main' },
        h('p', { class: 'score-number' }, `${report.overall}/5`),
        h('div', {},
          h('p', { class: `score-label ${verdictClass}` }, report.verdict),
          h('p', { class: 'muted' }, `${report.questionCount} questions · ${session.targetRole} · ${fillers} filler words in total`),
        ),
      ),
      scoreBars(report.averages),
      h('p', { class: 'verdict' }, report.summary),
    ),
    h('div', { class: 'card feedback-grid' },
      list('Strengths', report.strengths),
      list('Focus areas', report.focusAreas),
      list('Next steps', report.nextSteps),
    ),
    h('div', { class: 'card' },
      h('h3', {}, 'Question by question'),
      h('div', { class: 'table-scroll' },
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Round'), h('th', { scope: 'col' }, 'Question'), h('th', { scope: 'col' }, 'Score'))),
          h('tbody', {}, items.map((it, i) => h('tr', {},
            h('td', {}, String(i + 1)),
            h('td', {}, it.round),
            h('td', {}, it.question),
            h('td', {}, `${it.overall}/5`)))),
        ),
      ),
    ),
  );
  $('iv-result').querySelector('h2').focus();
}

async function getReport() {
  const button = $('iv-report');
  const status = $('iv-status');
  button.disabled = true;
  status.textContent = 'Writing your interview report…';
  try {
    const report = await api('/api/interview/report', {
      method: 'POST',
      body: {
        targetRole: session.targetRole,
        items: session.items.map(({ question, answer, round, scores }) => ({ question, answer, round, scores })),
      },
    });
    const sessions = getSessions();
    sessions.push({
      date: new Date().toISOString(),
      targetRole: session.targetRole,
      round: session.roundChoice,
      overall: report.overall,
      verdict: report.verdict,
      averages: report.averages,
    });
    save('interviewSessions', sessions.slice(-20));
    status.textContent = '';
    renderReport(report, session.items);
    session.finished = true;
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
    syncControls();
  }
}

export function init() {
  $('iv-next').addEventListener('click', nextQuestion);
  $('iv-feedback').addEventListener('click', getFeedback);
  $('iv-report').addEventListener('click', getReport);
  $('iv-answer').addEventListener('input', updateStats);
  $('iv-mode').addEventListener('change', () => resetSession(isSessionMode()
    ? `Full interview: ${SESSION_LENGTH} questions, then a report.`
    : 'Single-question practice.'));
  $('iv-round').addEventListener('change', () => {
    if (session && !session.finished && session.items.length) resetSession('Round changed, so the interview was restarted.');
  });
  setupSpeech();
  syncControls();
}

export function render() {
  const profile = getProfile();
  if (profile && !$('iv-role').value) $('iv-role').value = profile.targetRole;
}
