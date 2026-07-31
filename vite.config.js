import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api/stt': {
        target: 'http://192.168.1.245:9000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/stt/, '/asr'),
      },
      '/api/tts': {
        target: 'http://192.168.1.246:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tts/, '/tts'),
      },
      // Unlike /api/stt and /api/tts, this isn't a passthrough to a LAN
      // backend -- it needs the same Express route (server/index.js) that
      // production uses, since that's where the Anthropic API key and the
      // SSE->NDJSON translation live. Same target as /session below.
      '/api/claude-chat': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://192.168.1.241:11434',
        changeOrigin: true,
        // Ollama rejects requests whose Origin header doesn't match its
        // allowlist (DNS-rebinding protection). The browser sends the real
        // page origin (e.g. the phone's http://192.168.1.16:5173), which
        // Ollama doesn't trust, so rewrite it to the target's own origin.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', 'http://192.168.1.241:11434')
          })
        },
      },
      '/session': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    globals: true,
  },
})
