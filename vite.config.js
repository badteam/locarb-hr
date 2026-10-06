import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH is "/locarb-hr/" on GitHub Pages, "/" on a custom domain
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
