import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from the GitHub Pages project subpath.
  base: './',
  build: {
    // Rapier's compat build inlines its wasm, so the bundle is big on purpose.
    chunkSizeWarningLimit: 6000,
  },
});
