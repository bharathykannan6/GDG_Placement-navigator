import { register, start } from './router.js';
import * as home from './home.js';
import * as profile from './profile.js';
import * as diagnostic from './diagnostic.js';
import * as standing from './standing.js';
import * as plan from './plan.js';
import * as resume from './resume.js';
import * as interview from './interview.js';
import * as progress from './progress.js';

register('home', home);
register('profile', profile);
register('diagnostic', diagnostic);
register('standing', standing);
register('plan', plan);
register('resume', resume);
register('interview', interview);
register('progress', progress);

// The skip link must not change the hash (the hash selects the screen).
document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  document.getElementById('main').focus();
});

start();
