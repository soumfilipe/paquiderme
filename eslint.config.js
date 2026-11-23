import globals from 'globals';
import svelte from 'eslint-plugin-svelte';

// Lint enxuto: erros reais (variável não definida, import sem uso, laços vazios) em JS e Svelte.
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.js', '**/*.svelte'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.serviceworker } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      'svelte/no-at-html-tags': 'off', // Corpo.svelte usa {@html} só com saída de htmlSeguro (lib.js)
      'svelte/require-each-key': 'off',
      'svelte/prefer-svelte-reactivity': 'off', // Map/Set locais dentro de $derived são só temporários
      'svelte/no-dom-manipulating': 'off', // Ico e NoDom existem justamente para pôr nós de DOM no Svelte
      'svelte/prefer-writable-derived': 'warn',
    },
  },
  { files: ['**/*.svelte.js'], languageOptions: { globals: { $state: 'readonly', $derived: 'readonly', $effect: 'readonly' } } },
  { files: ['scripts/**', 'vite.config.js', 'eslint.config.js'], languageOptions: { globals: { ...globals.node } } },
];
