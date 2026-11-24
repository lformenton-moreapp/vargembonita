import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  // Aceita tanto as variáveis VITE_* quanto as criadas pela integração
  // Supabase da Vercel. Só a URL e a chave PÚBLICA (anon/publishable) vão para o app.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  // A integração pode criar nomes com prefixos variados (NEXT_PUBLIC_, STORAGE_...).
  // Procura qualquer variável terminada em SUPABASE_URL e na chave pública;
  // nunca usa a chave secreta (service role / secret).
  const achar = (...finais) => {
    for (const fim of finais) {
      const nome = Object.keys(env).sort().find((k) => k.endsWith(fim) && env[k] && !/SERVICE|SECRET|JWT/.test(k));
      if (nome) return env[nome];
    }
    return '';
  };
  const url = env.VITE_SUPABASE_URL || achar('SUPABASE_URL');
  const chave = env.VITE_SUPABASE_ANON_KEY || achar('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');
  return {
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(chave),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        painel: resolve(import.meta.dirname, 'painel/index.html'),
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'equipes.json'],
      manifest: {
        name: 'Missão Vargem Bonita',
        short_name: 'Missão VB',
        description: 'Mapeamento das visitas casa a casa em Vargem Bonita (MG)',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        background_color: '#14532d',
        theme_color: '#14532d',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,png,svg}'],
        navigateFallback: null,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Guarda os pedaços do mapa já vistos para funcionar sem sinal.
            urlPattern: /^https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mapa-osm',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Lista de equipes: tenta a rede, usa a cópia guardada se estiver sem sinal.
            urlPattern: ({ url }) => url.pathname.endsWith('/equipes.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'equipes', networkTimeoutSeconds: 4 },
          },
        ],
      },
    }),
  ],
};
});
