// Pure functions (no DOM) so they run in the browser and in Node tests.

export const FILLERS = ['um', 'uh', 'like', 'basically', 'actually', 'you know', 'so'];
export const WORDS_PER_MINUTE = 130; // typical conversational speaking pace

export function analyseAnswer(text) {
  const clean = String(text ?? '').trim();
  const words = clean ? clean.split(/\s+/).length : 0;
  const lower = clean.toLowerCase();

  const fillers = {};
  let fillerTotal = 0;
  for (const filler of FILLERS) {
    const pattern = new RegExp(`\\b${filler.replace(' ', '\\s+')}\\b`, 'g');
    const count = (lower.match(pattern) ?? []).length;
    if (count) {
      fillers[filler] = count;
      fillerTotal += count;
    }
  }

  return {
    words,
    seconds: Math.round((words / WORDS_PER_MINUTE) * 60),
    fillers,
    fillerTotal,
    fillerRate: words ? Math.round((fillerTotal / words) * 100) : 0,
  };
}

export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}
