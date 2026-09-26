import { createApp } from './src/app.js';

const port = Number(process.env.PORT) || 8080;

createApp().listen(port, () => {
  console.log(`Placement Navigator running on http://localhost:${port}`);
});
