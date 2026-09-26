// Hash-based screens: each <section data-screen="name"> is one screen.

const screens = new Map();

export function register(name, module) {
  screens.set(name, module);
}

export function go(name) {
  if (location.hash === `#${name}`) route();
  else location.hash = name;
}

export function route() {
  const requested = location.hash.slice(1) || 'home';
  const exists = document.querySelector(`[data-screen="${CSS.escape(requested)}"]`);
  const name = exists ? requested : 'home';

  for (const section of document.querySelectorAll('[data-screen]')) {
    section.hidden = section.dataset.screen !== name;
  }
  for (const link of document.querySelectorAll('.nav a')) {
    if (link.getAttribute('href') === `#${name}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  screens.get(name)?.render?.();
}

export function start() {
  for (const module of screens.values()) module.init?.();
  window.addEventListener('hashchange', route);
  route();
}
