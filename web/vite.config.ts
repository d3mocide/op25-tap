import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables from the project root (..)
  const env = loadEnv(mode, process.cwd() + '/..', '')
  // VITE_BACKEND_PORT wins so Docker can point at the backend's container port
  // even when PORT (the published host port) is set to something else.
  const backendPort = env.VITE_BACKEND_PORT || env.PORT || env.OP25TAP_PORT || '8000'
  const frontendPort = Number(env.FRONTEND_PORT) || 5173
  const backendHost = env.VITE_BACKEND_HOST || (env.HOST && env.HOST !== '0.0.0.0' ? env.HOST : '127.0.0.1')
  const backendTarget = `http://${backendHost}:${backendPort}`
  const wsTarget = `ws://${backendHost}:${backendPort}`

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: frontendPort,
      strictPort: true,
      watch: {
        usePolling: true,
      },
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/ws': {
          target: wsTarget,
          ws: true,
        },
      },
    },
  }
})
