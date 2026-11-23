<script>
	import { partesEmoji } from '../../lib.js';

	// Texto com emojis personalizados da instância (nomes, avisos de conteúdo, opções de enquete).
	let { texto = '', emojis = [] } = $props();
	const lista = $derived(partesEmoji(texto, emojis));
</script>

{#each lista as p}{#if p.url}<img class="emoji" src={p.url} alt={p.codigo} title={p.codigo} loading="lazy" />{:else}{p.t}{/if}{/each}
