<script>
	import { htmlSeguro } from '../../lib.js';

	// Conteúdo HTML vindo da instância (publicações, bios, avisos). Passa por `htmlSeguro` (lib.js): só as tags, classes e
	// endereços permitidos, com texto escapado e emojis personalizados; por isso o {@html} abaixo é seguro.
	let { html = '', emojis = [] } = $props();
	const seguro = $derived(htmlSeguro(html, emojis));
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html seguro}
