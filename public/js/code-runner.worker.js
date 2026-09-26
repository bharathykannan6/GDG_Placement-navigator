// Runs a student's JavaScript solution against test cases, inside a Web Worker:
// no access to the page, the DOM, cookies or storage, and (by its own CSP) no network.
// The page terminates this worker if a test runs too long.

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => deepEqual(a[key], b[key]));
}

function show(value) {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

self.onmessage = (event) => {
  const { code, functionName, tests } = event.data;
  const logs = [];
  const capture = (...parts) => {
    if (logs.length < 50) logs.push(parts.map((p) => (typeof p === 'string' ? p : show(p))).join(' ').slice(0, 300));
  };
  self.console = { log: capture, info: capture, warn: capture, error: capture, debug: capture };

  let solution;
  try {
    // eslint-disable-next-line no-new-func
    solution = new Function(`"use strict";\n${code}\n;return typeof ${functionName} === "function" ? ${functionName} : undefined;`)();
  } catch (err) {
    self.postMessage({ type: 'error', message: `${err.name}: ${err.message}`, logs });
    return;
  }
  if (typeof solution !== 'function') {
    self.postMessage({ type: 'error', message: `Define a function named ${functionName}.`, logs });
    return;
  }

  tests.forEach((test, index) => {
    self.postMessage({ type: 'start', index });
    const started = performance.now();
    try {
      const actual = solution(...structuredClone(test.args));
      self.postMessage({
        type: 'result',
        index,
        pass: deepEqual(actual, test.expected),
        actual: show(actual),
        ms: Math.round((performance.now() - started) * 10) / 10,
      });
    } catch (err) {
      self.postMessage({ type: 'result', index, pass: false, error: `${err.name}: ${err.message}` });
    }
  });

  self.postMessage({ type: 'done', logs });
};
