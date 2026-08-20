import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 后端 NestJS，见 backend/src/main.ts（globalPrefix: 'api'）
      '/api': 'http://localhost:3000',
    },
  },
})
