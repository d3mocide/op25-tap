import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables from the project root (..)
  const env = loadEnv(mode, process.cwd() + '/..', '')
  const backendPort = env.PORT || env.OP25TAP_PORT || '8000'
  const backendHost = env.VITE_BACKEND_HOST || (env.HOST && env.HOST !== '0.0.0.0' ? env.HOST : '127.0.0.1')
  const backendTarget = `http://${backendHost}:${backendPort}`
  const wsTarget = `ws://${backendHost}:${backendPort}`

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
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
