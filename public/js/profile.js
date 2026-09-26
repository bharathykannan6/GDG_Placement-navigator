import { load, save } from './store.js';

const form = () => document.getElementById('profile-form');

const FIELDS = {
  name: { label: 'Name', check: (v) => v.length >= 2 || 'Enter at least 2 characters.' },
  branch: { label: 'Branch', check: (v) => v !== '' || 'Choose your branch.' },
  year: { label: 'Year', check: (v) => v !== '' || 'Choose your year of study.' },
  targetRole: { label: 'Target role', check: (v) => v.length >= 2 || 'Enter the role you are aiming for.' },
  companyType: { label: 'Company type', check: (v) => v !== '' || 'Choose a company type.' },
  hoursPerWeek: {
    label: 'Hours per week',
    check: (v) => {
      const n = Number(v);
      return (Number.isInteger(n) && n >= 1 && n <= 60) || 'Enter a whole number from 1 to 60.';
    },
  },
  driveMonth: {
    label: 'Placement month',
    check: (v) => {
      if (!/^\d{4}-\d{2}$/.test(v)) return 'Choose the month placement drives start.';
      return v >= currentMonth() || 'Choose this month or a later one.';
    },
  },
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function getProfile() {
  return load('profile', null);
}

function showError(input, message) {
  const err = document.getElementById(`${input.id}-err`);
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    err.textContent = message;
    err.hidden = false;
  } else {
    input.removeAttribute('aria-invalid');
    err.textContent = '';
    err.hidden = true;
  }
}

function onSubmit(event) {
  event.preventDefault();
  const el = form();
  const status = document.getElementById('profile-status');
  const profile = {};
  let firstInvalid = null;

  for (const [name, field] of Object.entries(FIELDS)) {
    const input = el.elements[name];
    const value = input.value.trim();
    const result = field.check(value);
    showError(input, result === true ? '' : result);
    if (result !== true && !firstInvalid) firstInvalid = input;
    profile[name] = name === 'hoursPerWeek' ? Number(value) : value;
  }

  if (firstInvalid) {
    status.textContent = 'Please fix the highlighted fields.';
    firstInvalid.focus();
    return;
  }

  profile.updatedAt = new Date().toISOString();
  status.textContent = save('profile', profile)
    ? 'Profile saved.'
    : 'Could not save in this browser (storage is blocked). You can still continue.';
}

export function init() {
  form().addEventListener('submit', onSubmit);
  const el = form();
  el.elements.driveMonth.min = currentMonth();
}

export function render() {
  const profile = getProfile();
  if (!profile) return;
  const el = form();
  for (const name of Object.keys(FIELDS)) {
    if (profile[name] !== undefined) el.elements[name].value = profile[name];
  }
}
