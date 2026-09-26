import { register, start } from './router.js';
import * as profile from './profile.js';

register('profile', profile);

start();
