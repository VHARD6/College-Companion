import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    cssMinify: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/')
          const lastNodeModulesIndex = normalized.lastIndexOf('/node_modules/')
          if (lastNodeModulesIndex === -1) return

          const subPath = normalized.slice(lastNodeModulesIndex + '/node_modules/'.length)
          const parts = subPath.split('/')
          const packageName = parts[0].startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]

          if (packageName === 'lucide-react') {
            return 'vendor-icons'
          }
          if (packageName.startsWith('@supabase/')) {
            return 'vendor-supabase'
          }
          if (packageName.startsWith('@tanstack/')) {
            return 'vendor-query'
          }
          if (packageName.startsWith('@capacitor/')) {
            return 'vendor-capacitor'
          }
          if (
            packageName === 'react' ||
            packageName === 'react-dom' ||
            packageName === 'scheduler' ||
            packageName.startsWith('react-router') ||
            packageName === 'react-hot-toast' ||
            packageName.startsWith('@remix-run/')
          ) {
            return 'vendor-react'
          }

          return 'vendor-libs'
        },
      },
    },
  },
})
