<script>
	import { ui } from '../composicao.svelte.js';
	import NoDom from './NoDom.svelte';

	// Sugestões de @menção, #hashtag e :emoji: acima do teclado. `escolher(item)` insere no texto.
	let { escolher, seguro } = $props();
</script>

{#each ui.sugestoes as it (it.insert)}
	<button type="button" class="sg-item" onclick={() => escolher(it)}>
		{#if it.img}<img class={it.round ? 'ro-avatar avatar' : 'emoji-img'} src={seguro(it.img)} alt="" />{/if}
		<span class="sg-text"><strong>{#if typeof it.label === 'string'}{it.label}{:else}<NoDom no={it.label} />{/if}</strong>{#if it.sub}<span class="muted small">{it.sub}</span>{/if}</span>
	</button>
{/each}
