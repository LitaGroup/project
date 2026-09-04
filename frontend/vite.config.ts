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
      // 上传图片静态目录（DIR_IMAGE_WEBROOT，后端挂在 /images 下）
      '/images': 'http://localhost:3000',
      // 导出产物静态目录（DIR_EXPORT_WEBROOT，后端挂在 /export-files 下）
      '/export-files': 'http://localhost:3000',
    },
  },
})
