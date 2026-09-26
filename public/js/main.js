import { register, start } from './router.js';
import * as profile from './profile.js';
import * as diagnostic from './diagnostic.js';

register('profile', profile);
register('diagnostic', diagnostic);

start();
