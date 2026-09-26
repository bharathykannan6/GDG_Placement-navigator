// Small input checks shared by every route. Each helper returns the cleaned
// value or throws a ValidationError, which the app turns into a 400 response.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function object(value, field) {
  if (!isPlainObject(value)) throw new ValidationError(`${field} must be an object.`);
  return value;
}

export function text(value, field, { min = 1, max }) {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw new ValidationError(`${field} must be at least ${min} characters.`);
  if (trimmed.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`);
  return trimmed;
}

export function integer(value, field, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${field} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

export function oneOf(value, field, options) {
  if (!options.includes(value)) throw new ValidationError(`${field} must be one of: ${options.join(', ')}.`);
  return value;
}

export function list(value, field, { max, item }) {
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be a list.`);
  if (value.length > max) throw new ValidationError(`${field} can have at most ${max} items.`);
  return value.map((entry, i) => item(entry, `${field}[${i}]`));
}
