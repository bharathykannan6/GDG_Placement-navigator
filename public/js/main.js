import { register, start } from './router.js';
import * as profile from './profile.js';
import * as diagnostic from './diagnostic.js';
import * as standing from './standing.js';
import * as plan from './plan.js';
import * as resume from './resume.js';

register('profile', profile);
register('diagnostic', diagnostic);
register('standing', standing);
register('plan', plan);
register('resume', resume);

start();
