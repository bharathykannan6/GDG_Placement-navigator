import { AiError } from '../src/gemini.js';

export const PROFILE = {
  name: 'Test Student',
  branch: 'CSE',
  year: 'Final year',
  targetRole: 'Software Engineer',
  companyType: 'Product',
  hoursPerWeek: 10,
  driveMonth: '2099-12',
};

export const SCORES = {
  overall: 55,
  byArea: {
    Aptitude: { correct: 5, total: 5, percent: 100 },
    DSA: { correct: 5, total: 5, percent: 100 },
    'CS Fundamentals': { correct: 1, total: 5, percent: 20 },
    Communication: { correct: 0, total: 5, percent: 0 },
  },
};

export const RESUME = [
  'Test Student | test.student@example.com | +91 98765 43210',
  'B.E. Computer Science, 2022 - 2026, CGPA 8.2',
  'Projects: Worked on a website for college fest using React and Node.js.',
  'Internship: Web developer intern for 2 months, fixed bugs in the admin panel.',
  'Skills: JavaScript, Python, HTML, CSS',
].join('\n');

const RESPONSES = {
  plan: {
    summary: 'Focus on communication and CS fundamentals.',
    priorities: [{ area: 'Communication', why: 'Lowest score', actions: ['Practise daily'] }],
    weeklyPlan: [{ week: 7, focus: 'Basics', tasks: ['Task A', 'Task B'] }],
    dailyHabit: 'One question a day.',
    resources: [{ area: 'DSA', type: 'unknown-type', suggestion: 'Arrays' }],
    extraField: 'should be removed',
  },
  resume: {
    matchScore: 140,
    verdict: 'Decent start.',
    strengths: ['Project'],
    missingKeywords: ['SQL'],
    bulletRewrites: [
      { before: 'Worked on a website for college fest', after: 'Built the college fest website' },
      { before: 'Led a team of 50 engineers', after: 'Invented line' },
    ],
    nextSteps: ['Add metrics'],
  },
  question: { question: 'What is a deadlock?', tip: 'Name the four conditions.' },
  code: {
    verdict: 'Has bugs',
    summary: 'Returns values instead of indices.',
    timeComplexity: 'O(n^2)',
    spaceComplexity: 'O(1)',
    issues: ['Returns nums[i] instead of i'],
    edgeCases: ['[3,3]'],
    improvements: ['Use a hash map'],
  },
  mentor: {
    reply: 'Focus on Communication first.\n- Practise one HR answer today',
    followUps: ['One', 'Two', 'Three', 'Four is dropped'],
  },
  report: {
    summary: 'Relevant answers that need more structure.',
    strengths: ['Relevant examples'],
    focusAreas: ['Use STAR', 'Give results', 'Slow down', 'Fourth is dropped'],
    nextSteps: ['Practise 3 HR answers'],
  },
  feedback: {
    scores: { relevance: 4, structure: 2, clarity: 3, depth: 9 },
    whatWorked: ['Clear'],
    improve: ['Use STAR'],
    betterAnswer: 'A better answer.',
  },
};

function kindOf(schema) {
  const required = schema.required.join(',');
  if (required.includes('weeklyPlan')) return 'plan';
  if (required.includes('matchScore')) return 'resume';
  if (required.includes('betterAnswer')) return 'feedback';
  if (required.includes('timeComplexity')) return 'code';
  if (required === 'reply,followUps') return 'mentor';
  if (required.includes('focusAreas')) return 'report';
  return 'question';
}

/** Fake model: records every call and returns canned JSON per feature. */
export function fakeAi({ fail } = {}) {
  const calls = [];
  return {
    calls,
    async generateJson(args) {
      calls.push(args);
      if (fail === 'ai') throw new AiError('The AI service did not respond. Please try again.');
      if (fail === 'crash') throw new Error('internal detail that must not leak');
      return structuredClone(RESPONSES[kindOf(args.schema)]);
    },
  };
}

/**
 * Builds a minimal one-page PDF. With `lines` it contains real text (like a normal
 * resume export); with no lines it only draws a shape (like a scanned image).
 */
export function makePdf(lines = []) {
  const esc = (s) => s.replace(/[\()]/g, (c) => `\${c}`);
  const content = lines.length
    ? `BT /F1 11 Tf 50 750 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`
    : '0.5 g 50 500 300 200 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
