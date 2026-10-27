import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 开发环境固定端口（strictPort：被占用时直接报错而不是换端口）
    port: 5273,
    strictPort: true,
    proxy: {
      // 后端 NestJS（固定 3100），见 backend/src/main.ts（globalPrefix: 'api'）
      '/api': 'http://localhost:3100',
      // 上传图片静态目录（DIR_IMAGE_WEBROOT，后端挂在 /images 下）
      '/images': 'http://localhost:3100',
      // 导出产物静态目录（DIR_EXPORT_WEBROOT，后端挂在 /export-files 下）
      '/export-files': 'http://localhost:3100',
      // 通用上传文件静态目录（DIR_FILE_WEBROOT，后端挂在 /files 下）
      '/files': 'http://localhost:3100',
    },
  },
})
