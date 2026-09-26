// Pure progress calculations (no DOM) so they can be tested in Node.

const round1 = (n) => Math.round(n * 10) / 10;
const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

export function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

/** Change between the last two diagnostic attempts, overall and per area. */
export function attemptDeltas(attempts) {
  if (!Array.isArray(attempts) || attempts.length < 2) return null;
  const [prev, latest] = attempts.slice(-2);
  const deltas = { overall: latest.overall - prev.overall, byArea: {} };
  for (const [area, stats] of Object.entries(latest.byArea)) {
    deltas.byArea[area] = stats.percent - (prev.byArea?.[area]?.percent ?? 0);
  }
  return deltas;
}

/** Average interview score and filler words per round, over the last `lastN` answers. */
export function interviewSummary(interviews, lastN = 5) {
  const rounds = {};
  for (const round of ['HR', 'Technical']) {
    const recent = interviews.filter((i) => i.round === round).slice(-lastN);
    rounds[round] = recent.length
      ? {
          count: recent.length,
          average: round1(average(recent.map((i) => i.overall))),
          fillersPerAnswer: round1(average(recent.map((i) => i.fillerTotal ?? 0))),
        }
      : null;
  }
  return { total: interviews.length, rounds };
}

export function planCompletion(saved) {
  if (!saved?.plan) return null;
  const total = saved.plan.weeklyPlan.reduce((n, week) => n + week.tasks.length, 0);
  const done = Object.values(saved.done ?? {}).filter(Boolean).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}
