import { api } from './api.js';
import { h, clear } from './dom.js';
import { load, save } from './store.js';
import { getProfile } from './profile.js';
import { bar } from './standing.js';

const MIN = 100;
const MAX = 8000;
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const SOURCE_NOTE = {
  'pdf-text': 'Text was read from your PDF on our server; emails and phone numbers were removed before the AI saw it.',
  'pdf-gemini': 'Your PDF had no selectable text (it looks scanned), so Gemini read the pages directly. The file was sent to Gemini as-is.',
};
let lastReview = null;

const $ = (id) => document.getElementById(id);

export function getResumeHistory() {
  return load('resumeReviews', []);
}

function updateCounter() {
  const length = $('resume-text').value.trim().length;
  $('resume-count').textContent = `${length} / ${MAX} characters${length < MIN ? ` (at least ${MIN})` : ''}`;
}

function list(title, items) {
  if (!items.length) return null;
  return h('div', {}, h('h3', {}, title), h('ul', {}, items.map((item) => h('li', {}, item))));
}

function renderResult(review) {
  const out = clear($('resume-result'));
  out.append(
    h('div', { class: 'card' },
      h('h2', { tabindex: '-1' }, 'Resume match'),
      h('div', { class: 'score-main' },
        h('p', { class: 'score-number' }, `${review.matchScore}%`),
        h('p', { class: 'muted' }, `for ${review.targetRole}`),
      ),
      bar(review.matchScore),
      h('p', { class: 'verdict' }, review.verdict),
      review.source && h('p', { class: 'muted' }, SOURCE_NOTE[review.source] ?? '',
        review.truncated ? ' Only the first 8000 characters were reviewed.' : ''),
    ),
    h('div', { class: 'card' },
      list('What already works', review.strengths),
      review.missingKeywords.length > 0 && h('div', {},
        h('h3', {}, 'Missing for this role'),
        h('ul', { class: 'tag-list' }, review.missingKeywords.map((k) => h('li', { class: 'tag' }, k))),
      ),
      list('Next steps', review.nextSteps),
    ),
    review.bulletRewrites.length > 0 && h('div', { class: 'card' },
      h('h3', {}, 'Stronger resume lines'),
      h('div', { class: 'table-scroll' },
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Before'), h('th', { scope: 'col' }, 'After'))),
          h('tbody', {}, review.bulletRewrites.map((r) => h('tr', {}, h('td', {}, r.before), h('td', {}, r.after)))),
        ),
      ),
    ),
  );
  out.querySelector('h2').focus();
}

async function onSubmit(event) {
  event.preventDefault();
  const status = $('resume-status');
  const button = $('resume-submit');
  const resumeText = $('resume-text').value.trim();
  const targetRole = $('resume-role').value.trim();

  if (resumeText.length < MIN) {
    status.textContent = `Paste at least ${MIN} characters of your resume.`;
    $('resume-text').focus();
    return;
  }
  if (targetRole.length < 2) {
    status.textContent = 'Enter the role you are applying for.';
    $('resume-role').focus();
    return;
  }

  button.disabled = true;
  status.textContent = 'Reviewing your resume…';
  try {
    const review = await api('/api/resume/review', { method: 'POST', body: { resumeText, targetRole } });
    lastReview = { ...review, targetRole };
    const history = getResumeHistory();
    history.push({ date: new Date().toISOString(), targetRole, matchScore: review.matchScore });
    save('resumeReviews', history.slice(-20));
    status.textContent = 'Review ready.';
    renderResult(lastReview);
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

async function onPdf() {
  const status = $('resume-status');
  const button = $('resume-pdf-submit');
  const file = $('resume-pdf').files[0];
  const targetRole = $('resume-role').value.trim();

  if (!file) {
    status.textContent = 'Choose a PDF file first.';
    $('resume-pdf').focus();
    return;
  }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    status.textContent = 'Please choose a .pdf file.';
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    status.textContent = 'The PDF is larger than 4 MB. Export a smaller file or paste the text instead.';
    return;
  }
  if (targetRole.length < 2) {
    status.textContent = 'Enter the role you are applying for.';
    $('resume-role').focus();
    return;
  }

  button.disabled = true;
  status.textContent = 'Reading your PDF and reviewing it…';
  try {
    const pdf = file.type === 'application/pdf' ? file : new Blob([file], { type: 'application/pdf' });
    const review = await api(`/api/resume/review-pdf?targetRole=${encodeURIComponent(targetRole)}`, { method: 'POST', file: pdf });
    lastReview = { ...review, targetRole };
    const history = getResumeHistory();
    history.push({ date: new Date().toISOString(), targetRole, matchScore: review.matchScore });
    save('resumeReviews', history.slice(-20));
    status.textContent = 'Review ready.';
    renderResult(lastReview);
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

export function init() {
  $('resume-form').addEventListener('submit', onSubmit);
  $('resume-pdf-submit').addEventListener('click', onPdf);
  $('resume-text').addEventListener('input', updateCounter);
  $('resume-text').maxLength = MAX;
}

export function render() {
  const profile = getProfile();
  if (profile && !$('resume-role').value) $('resume-role').value = profile.targetRole;
  updateCounter();
  if (lastReview && !$('resume-result').childElementCount) renderResult(lastReview);
}
