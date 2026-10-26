import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { offlinePlugin } from './offlinePlugin.ts'

// https://vite.dev/config/
export default defineConfig({
  // GitHub project Pages uses /repository/; local development keeps /.
  base: process.env.MATU_BASE_PATH || '/',
  plugins: [react(), offlinePlugin()],
  // A self-contained worker avoids a second module fetch after the user goes offline.
  worker: { format: 'es', rolldownOptions: { output: { codeSplitting: false } } },
})
