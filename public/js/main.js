import { register, start } from './router.js';
import * as profile from './profile.js';
import * as diagnostic from './diagnostic.js';
import * as standing from './standing.js';

register('profile', profile);
register('diagnostic', diagnostic);
register('standing', standing);

start();
