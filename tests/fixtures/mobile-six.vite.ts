// CyberManju OS — Mobile fixture Vite configuration.
// Role: serve production components against explicitly non-production IO mocks.
// Exports: Vite config for manual responsive regression checks only.
// Integrates: Vue compiler, mobile-six.html, mobile-six-mocks.ts.
// Contracts: not imported by production build configuration.
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '../..')
const mock = resolve(import.meta.dirname, 'mobile-six-mocks.ts')
export default defineConfig({
  root, plugins: [vue()],
  resolve: { alias: [
    { find: '@/stores/app', replacement: mock },
    { find: '@/composables/useProviderCanal', replacement: mock },
    { find: '@/composables/useWindowManager', replacement: mock },
    { find: '@', replacement: resolve(root, 'src') },
  ] },
  server: { host: '0.0.0.0', port: 5267, strictPort: true },
})
