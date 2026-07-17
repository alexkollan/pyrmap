import { defineConfig } from 'vite';
// any-ok not needed; @vitejs/plugin-react is required to build the React+Vite stack fixed in dev-plan §2 — not in the literal dep list but implied by it (Decision log 2026-07-17).
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
