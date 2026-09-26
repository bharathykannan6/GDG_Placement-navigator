import { Router } from 'express';
import { requireAi } from '../gemini.js';
import { AREAS } from './diagnostic.js';
import { ValidationError, integer, object, text } from '../validate.js';

const MAX_PLAN_WEEKS = 8;

const SYSTEM = `You are a placement mentor for Indian engineering students.
Give specific, realistic advice a student can act on this week.
Base the priorities on the weakest diagnostic areas first.
Fit the workload to the hours available per week and the weeks left.
Use plain, encouraging language. Do not invent company-specific facts,
cut-offs, dates or salary figures. Do not recommend paid courses by name.`;

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences on where the student stands and the strategy.' },
    priorities: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          why: { type: 'string' },
          actions: { type: 'array', maxItems: 4, items: { type: 'string' } },
        },
        required: ['area', 'why', 'actions'],
      },
    },
    weeklyPlan: {
      type: 'array',
      maxItems: MAX_PLAN_WEEKS,
      items: {
        type: 'object',
        properties: {
          week: { type: 'integer' },
          focus: { type: 'string' },
          tasks: { type: 'array', maxItems: 5, items: { type: 'string' } },
        },
        required: ['week', 'focus', 'tasks'],
      },
    },
    dailyHabit: { type: 'string' },
    resources: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          type: { type: 'string', enum: ['practice', 'video', 'notes', 'mock'] },
          suggestion: { type: 'string' },
        },
        required: ['area', 'type', 'suggestion'],
      },
    },
  },
  required: ['summary', 'priorities', 'weeklyPlan', 'dailyHabit', 'resources'],
};

/** Whole weeks from `today` until the 1st of driveMonth (YYYY-MM), at least 1. */
export function weeksUntil(driveMonth, today = new Date()) {
  const [year, month] = driveMonth.split('-').map(Number);
  const start = Date.UTC(year, month - 1, 1);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.min(Math.max(Math.ceil((start - now) / (7 * 24 * 3600 * 1000)), 1), 52);
}

function validate(body) {
  const profile = object(body?.profile, 'profile');
  const scores = object(body?.scores, 'scores');

  const driveMonth = text(profile.driveMonth, 'profile.driveMonth', { max: 7 });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(driveMonth)) throw new ValidationError('profile.driveMonth must look like 2026-12.');

  const byAreaIn = object(scores.byArea, 'scores.byArea');
  const byArea = {};
  for (const area of AREAS) {
    const stats = object(byAreaIn[area], `scores.byArea.${area}`);
    byArea[area] = integer(stats.percent, `scores.byArea.${area}.percent`, { min: 0, max: 100 });
  }

  return {
    profile: {
      branch: text(profile.branch, 'profile.branch', { max: 30 }),
      year: text(profile.year, 'profile.year', { max: 20 }),
      targetRole: text(profile.targetRole, 'profile.targetRole', { min: 2, max: 60 }),
      companyType: text(profile.companyType, 'profile.companyType', { max: 40 }),
      hoursPerWeek: integer(profile.hoursPerWeek, 'profile.hoursPerWeek', { min: 1, max: 60 }),
      driveMonth,
    },
    scores: {
      overall: integer(scores.overall, 'scores.overall', { min: 0, max: 100 }),
      byAreaPercent: byArea,
    },
  };
}

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, maxItems) => (Array.isArray(v) ? v.map((s) => str(s)).filter(Boolean).slice(0, maxItems) : []);

/** Keeps only the fields and sizes we expect, whatever the model returns. */
export function shapePlan(raw, weeksLeft) {
  const plan = raw && typeof raw === 'object' ? raw : {};
  return {
    summary: str(plan.summary, 800),
    weeksLeft,
    priorities: (Array.isArray(plan.priorities) ? plan.priorities : []).slice(0, 4).map((p) => ({
      area: str(p?.area, 60),
      why: str(p?.why),
      actions: strList(p?.actions, 4),
    })),
    weeklyPlan: (Array.isArray(plan.weeklyPlan) ? plan.weeklyPlan : []).slice(0, MAX_PLAN_WEEKS).map((w, i) => ({
      week: i + 1,
      focus: str(w?.focus, 120),
      tasks: strList(w?.tasks, 5),
    })),
    dailyHabit: str(plan.dailyHabit),
    resources: (Array.isArray(plan.resources) ? plan.resources : []).slice(0, 6).map((r) => ({
      area: str(r?.area, 60),
      type: ['practice', 'video', 'notes', 'mock'].includes(r?.type) ? r.type : 'practice',
      suggestion: str(r?.suggestion),
    })),
  };
}

export function planRouter(ai) {
  const router = Router();

  router.post('/', requireAi(ai), async (req, res) => {
    const input = validate(req.body);
    const weeksLeft = weeksUntil(input.profile.driveMonth);
    const planWeeks = Math.min(weeksLeft, MAX_PLAN_WEEKS);

    const prompt = [
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      `Placement drives start in about ${weeksLeft} week(s). Write a week-by-week plan for the next ${planWeeks} week(s).`,
      'Student profile and diagnostic scores (percent correct per area):',
      JSON.stringify(input, null, 2),
    ].join('\n');

    const raw = await ai.generateJson({ system: SYSTEM, prompt, schema: PLAN_SCHEMA });
    res.json(shapePlan(raw, weeksLeft));
  });

  return router;
}
