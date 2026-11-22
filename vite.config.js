import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Fase 1: o app continua em módulos ES simples; o Vite só empacota. O Svelte já está ligado
// para as telas novas (arquivos .svelte) entrarem uma a uma, sem mexer no resto.
// Manifesto, ícones e marca ficam fora do empacotamento (o manifesto aponta para os ícones pelo nome
// e o iOS pede o apple-touch-icon num endereço fixo): protege os links antes do Vite e restaura depois.
const estaticos = () => [
  { name: 'estaticos-antes', transformIndexHtml: { order: 'pre', handler: (h) => h.replace(/(href=")\/((?:manifest\.webmanifest|brand\/|icons\/)[^"]*)"/g, '$1__FIXO__$2"') } },
  { name: 'estaticos-depois', transformIndexHtml: { order: 'post', handler: (h) => h.replaceAll('__FIXO__', './') } },
];

export default defineConfig({
  base: './',
  plugins: [svelte(), ...estaticos()],
  publicDir: false,
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 8765 },
});
