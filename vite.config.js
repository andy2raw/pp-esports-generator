import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/prizepicks': {
        target: 'https://partner-api.prizepicks.com',
        changeOrigin: true,
        rewrite: path => '/projections?per_page=250&single_stat=true',
        secure: true,
      },
      '/api/pandascore': {
        target: 'https://api.pandascore.co',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
