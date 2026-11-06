import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  return {
  envDir: '../..',
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      version: { name: process.env.GANADITO_RELEASE_SHA || 'development' }
    })
  ],
  server: {
    host: '127.0.0.1', port: 3000,
    proxy: {
      '^/api/v1/subastas/[^/]+/live': {
        target: env.API_INTERNAL_URL || 'http://127.0.0.1:4000', ws: true, changeOrigin: true
      }
    }
  }
  };
});
