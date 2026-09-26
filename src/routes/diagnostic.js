import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { ValidationError, object } from '../validate.js';

export const AREAS = ['Aptitude', 'DSA', 'CS Fundamentals', 'Communication'];

const bank = JSON.parse(readFileSync(new URL('../../data/questions.json', import.meta.url), 'utf8'));
const byId = new Map(bank.map((q) => [q.id, q]));

/** Questions as sent to the browser: no answers, no explanations. */
export function publicQuestions() {
  return bank.map(({ id, area, question, options }) => ({ id, area, question, options }));
}

/** Scores { questionId: optionIndex }. Unanswered questions count as wrong. */
export function scoreAnswers(answers) {
  const byArea = Object.fromEntries(AREAS.map((area) => [area, { correct: 0, total: 0, percent: 0 }]));
  const review = [];
  let correctCount = 0;

  for (const q of bank) {
    const chosen = Object.hasOwn(answers, q.id) ? answers[q.id] : null;
    const correct = chosen === q.answer;
    byArea[q.area].total += 1;
    if (correct) {
      byArea[q.area].correct += 1;
      correctCount += 1;
    }
    review.push({
      id: q.id,
      area: q.area,
      question: q.question,
      chosen: chosen === null ? null : q.options[chosen],
      answer: q.options[q.answer],
      correct,
      explanation: q.explanation,
    });
  }

  for (const stats of Object.values(byArea)) {
    stats.percent = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
  }

  return {
    overall: Math.round((correctCount / bank.length) * 100),
    correct: correctCount,
    total: bank.length,
    byArea,
    review,
  };
}

function validateAnswers(body) {
  const answers = object(body?.answers, 'answers');
  const entries = Object.entries(answers);
  if (entries.length > bank.length) throw new ValidationError(`answers can have at most ${bank.length} entries.`);

  for (const [id, value] of entries) {
    const q = byId.get(id);
    if (!q) throw new ValidationError(`Unknown question id: ${id.slice(0, 40)}`);
    if (!Number.isInteger(value) || value < 0 || value >= q.options.length) {
      throw new ValidationError(`Answer for ${id} must be an option index from 0 to ${q.options.length - 1}.`);
    }
  }
  return answers;
}

export function diagnosticRouter() {
  const router = Router();

  router.get('/questions', (req, res) => {
    res.json({ areas: AREAS, questions: publicQuestions() });
  });

  router.post('/score', (req, res) => {
    res.json(scoreAnswers(validateAnswers(req.body)));
  });

  return router;
}
