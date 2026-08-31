import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the same build works on GitHub Pages under a repo
  // subpath and inside the Tauri desktop shell, which loads from a file URL.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});
