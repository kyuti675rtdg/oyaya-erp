import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'maskable.svg'],
      manifest: {
        name: 'Oyaya Flour Factory ERP',
        short_name: 'Oyaya ERP',
        description:
          'Enterprise resource planning for Oyaya Flour Factory — offline-capable mill operations.',
        theme_color: '#0F172A',
        background_color: '#F8FAFC',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'oyaya-api-cache',
              expiration: { maxEntries: 300, maxAgeSeconds: 5 * 60 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  server: {
    port: 8903,
    proxy: {
      '/api': { target: 'http://localhost:8902', changeOrigin: true }
    }
  },
  preview: { port: 8903 }
});
