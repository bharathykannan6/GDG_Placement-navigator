import { Router } from 'express';
import { AiError, requireAi } from '../gemini.js';
import { ValidationError, integer, isPlainObject, list, object, oneOf, text } from '../validate.js';

const MAX_MESSAGES = 12;

const SYSTEM = `You are the mentor inside Placement Navigator, helping an Indian engineering student prepare for campus placements.
Use the student context below to personalise every answer (their target role, weakest areas, plan, practice results).
Be concise: under 150 words unless the student asks for detail. End with one concrete next action.
Write plain text: short paragraphs and "- " bullets. No markdown headings, bold or tables.
Stay on placement preparation: aptitude, coding, CS subjects, resumes, projects, interviews, communication, study habits and motivation.
For anything else, say briefly that you can only help with placement preparation.
Do not invent company-specific facts (cut-offs, salaries, dates, hiring numbers, test patterns). If asked, tell the student to check the company's official careers page or their placement cell.
If the student sounds stressed, be warm and practical.
In followUps, suggest up to 3 short questions the student might ask next.`;

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    followUps: { type: 'array', maxItems: 3, items: { type: 'string' } },
  },
  required: ['reply', 'followUps'],
};

const optional = (value, check) => (value === undefined || value === null ? undefined : check(value));

/** Accepts only known context fields, each with a size limit. The student's name is never accepted. */
export function validateContext(raw) {
  if (raw === undefined || raw === null) return {};
  const c = object(raw, 'context');
  const context = {
    branch: optional(c.branch, (v) => text(v, 'context.branch', { max: 30 })),
    year: optional(c.year, (v) => text(v, 'context.year', { max: 20 })),
    targetRole: optional(c.targetRole, (v) => text(v, 'context.targetRole', { max: 60 })),
    companyType: optional(c.companyType, (v) => text(v, 'context.companyType', { max: 40 })),
    hoursPerWeek: optional(c.hoursPerWeek, (v) => integer(v, 'context.hoursPerWeek', { min: 1, max: 60 })),
    driveMonth: optional(c.driveMonth, (v) => text(v, 'context.driveMonth', { max: 7 })),
    overallScore: optional(c.overallScore, (v) => integer(v, 'context.overallScore', { min: 0, max: 100 })),
    planSummary: optional(c.planSummary, (v) => text(v, 'context.planSummary', { max: 800 })),
    planFocus: optional(c.planFocus, (v) => list(v, 'context.planFocus', { max: 8, item: (x, f) => text(x, f, { max: 120 }) })),
    codingSolved: optional(c.codingSolved, (v) => integer(v, 'context.codingSolved', { min: 0, max: 100 })),
    codingTotal: optional(c.codingTotal, (v) => integer(v, 'context.codingTotal', { min: 0, max: 100 })),
    interviewAverage: optional(c.interviewAverage, (v) => {
      if (typeof v !== 'number' || v < 0 || v > 5) throw new ValidationError('context.interviewAverage must be from 0 to 5.');
      return v;
    }),
    resumeMatch: optional(c.resumeMatch, (v) => integer(v, 'context.resumeMatch', { min: 0, max: 100 })),
  };
  if (c.areaScores !== undefined) {
    const scores = object(c.areaScores, 'context.areaScores');
    const entries = Object.entries(scores);
    if (entries.length > 8) throw new ValidationError('context.areaScores has too many areas.');
    context.areaScores = Object.fromEntries(entries.map(([area, value]) => [
      text(area, 'context.areaScores key', { max: 40 }),
      integer(value, `context.areaScores.${area.slice(0, 40)}`, { min: 0, max: 100 }),
    ]));
  }
  return Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined));
}

export function describeContext(ctx) {
  const lines = [];
  if (ctx.targetRole) lines.push(`Target role: ${ctx.targetRole}${ctx.companyType ? ` (${ctx.companyType} companies)` : ''}`);
  if (ctx.branch || ctx.year) lines.push(`Branch/year: ${[ctx.branch, ctx.year].filter(Boolean).join(', ')}`);
  if (ctx.hoursPerWeek) lines.push(`Time available: ${ctx.hoursPerWeek} hours per week`);
  if (ctx.driveMonth) lines.push(`Placement drives start: ${ctx.driveMonth}`);
  if (ctx.overallScore !== undefined) lines.push(`Latest diagnostic: ${ctx.overallScore}% overall`);
  if (ctx.areaScores) lines.push(`Diagnostic by area: ${Object.entries(ctx.areaScores).map(([a, v]) => `${a} ${v}%`).join(', ')}`);
  if (ctx.planSummary) lines.push(`Current plan: ${ctx.planSummary}`);
  if (ctx.planFocus?.length) lines.push(`Plan weekly focus: ${ctx.planFocus.join('; ')}`);
  if (ctx.codingSolved !== undefined) lines.push(`Coding practice: ${ctx.codingSolved} of ${ctx.codingTotal ?? '?'} problems solved`);
  if (ctx.interviewAverage !== undefined) lines.push(`Mock interview average: ${ctx.interviewAverage}/5`);
  if (ctx.resumeMatch !== undefined) lines.push(`Resume match for target role: ${ctx.resumeMatch}%`);
  return lines.length ? lines.join('\n') : 'No context yet: the student has not filled in their profile or taken the diagnostic.';
}

function validateMessages(value) {
  const messages = list(value, 'messages', {
    max: MAX_MESSAGES,
    item: (m, field) => {
      if (!isPlainObject(m)) throw new ValidationError(`${field} must be an object.`);
      return { role: oneOf(m.role, `${field}.role`, ['user', 'model']), text: text(m.text, `${field}.text`, { max: 2000 }) };
    },
  });
  if (!messages.length) throw new ValidationError('messages must not be empty.');
  if (messages[0].role !== 'user') throw new ValidationError('The conversation must start with a user message.');
  if (messages.at(-1).role !== 'user') throw new ValidationError('The last message must be from the user.');
  return messages;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function mentorRouter(ai) {
  const router = Router();

  router.post('/chat', requireAi(ai), async (req, res) => {
    const messages = validateMessages(req.body?.messages);
    const context = validateContext(req.body?.context);

    const raw = await ai.generateJson({
      system: `${SYSTEM}\n\nStudent context:\n${describeContext(context)}`,
      prompt: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      schema: SCHEMA,
      temperature: 0.6,
    });

    const reply = str(raw?.reply, 2000);
    if (!reply) throw new AiError('The mentor did not reply. Please try again.');
    const followUps = Array.isArray(raw?.followUps) ? raw.followUps.map((f) => str(f, 120)).filter(Boolean).slice(0, 3) : [];
    res.json({ reply, followUps });
  });

  return router;
}
