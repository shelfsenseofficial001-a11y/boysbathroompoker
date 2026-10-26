// Vite builds the Vue app into dist/, which the Express server then serves
// alongside the REST endpoints and the Socket.IO connection the table runs
// on. The game needs a real long-lived process, so this stays a build step
// in front of the existing server rather than a deploy target of its own.
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const SERVER = 'http://localhost:3000';

export default defineConfig({
  plugins: [vue()],
  // Fonts, the favicon and the emoji list are copied through untouched. They
  // are served from this machine so the game works with no internet.
  publicDir: 'static',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // The 404 page is its own document: Express sends it for any wrong turn
      // that isn't an API call, so it must stand up without the app's bundle.
      input: { main: 'index.html', 404: '404.html' },
    },
  },
  server: {
    port: 5173,
    // The API and the socket live on the Node server. Proxied rather than
    // CORS-opened, so the session cookie and the WebSocket upgrade both
    // behave exactly as they do in production.
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/socket.io': { target: SERVER, ws: true, changeOrigin: true },
    },
  },
});
