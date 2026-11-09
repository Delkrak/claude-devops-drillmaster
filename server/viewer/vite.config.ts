import stylex from '@stylexjs/unplugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The viewer is built into the server's dist, and served by the Drillmaster server itself.
// StyleX compiles every stylex.create / defineVars into one static CSS file at build time.
export default defineConfig({
  root: import.meta.dirname,
  base: '/',
  plugins: [stylex.vite(), react()],
  build: { outDir: '../dist/viewer', emptyOutDir: true },
  server: {
    // During development, point the API at a running Drillmaster server: DRILLMASTER_URL=http://127.0.0.1:<port>
    proxy: { '/api': process.env.DRILLMASTER_URL ?? 'http://127.0.0.1:7777' },
  },
})
