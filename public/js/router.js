// Hash-based screens: each <section data-screen="name"> is one screen.

const screens = new Map();
const APP_NAME = 'Placement Navigator';

export function register(name, module) {
  screens.set(name, module);
}

export function go(name) {
  if (location.hash === `#${name}`) route();
  else location.hash = name;
}

export function route({ moveFocus = true } = {}) {
  const requested = location.hash.slice(1) || 'home';
  const exists = document.querySelector(`[data-screen="${CSS.escape(requested)}"]`);
  const name = exists ? requested : 'home';
  let active = null;

  for (const section of document.querySelectorAll('[data-screen]')) {
    section.hidden = section.dataset.screen !== name;
    if (!section.hidden) active = section;
  }

  let label = '';
  for (const link of document.querySelectorAll('.nav a')) {
    if (link.getAttribute('href') === `#${name}`) {
      link.setAttribute('aria-current', 'page');
      link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      label = link.textContent;
    } else {
      link.removeAttribute('aria-current');
    }
  }
  document.title = name === 'home' || !label ? APP_NAME : `${label} · ${APP_NAME}`;

  screens.get(name)?.render?.();

  // Tell keyboard and screen-reader users the screen changed.
  const heading = active?.querySelector('h1');
  if (moveFocus && heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
}

export function start() {
  for (const module of screens.values()) module.init?.();
  window.addEventListener('hashchange', () => route());
  route({ moveFocus: false });
}
