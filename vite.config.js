import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.js'] },
});
