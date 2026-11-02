import './style.css';
import { App } from './app';

const app = new App();
// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { app });
