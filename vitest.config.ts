// Vitest uses Vite's resolver so tests can import the same TypeScript modules as production.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests run in Node because these units cover pure projection, model, and Web Crypto session logic.
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
