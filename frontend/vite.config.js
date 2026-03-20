import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/recipes': 'http://127.0.0.1:8080',
      '/analyze': 'http://127.0.0.1:8080',
      '/shopping-list': 'http://127.0.0.1:8080',
      '/import-url': 'http://127.0.0.1:8080',
      '/static': 'http://127.0.0.1:8080', 
    }
  }
})