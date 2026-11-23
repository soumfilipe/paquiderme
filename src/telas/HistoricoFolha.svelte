<script>
	import Corpo from './Corpo.svelte';
	import Emoji from './Emoji.svelte';

	// Histórico de edições de uma publicação (folha). `versoes`: resposta da API, da mais antiga para a mais nova.
	let { versoes } = $props();
	const lista = $derived(versoes.slice().reverse());
</script>

<div class="history">
	{#each lista as v, i (v.created_at)}
		<div class="hist-item">
			<div class="muted small">{i === 0 ? 'Atual · ' : ''}{new Date(v.created_at).toLocaleString('pt-BR')}</div>
			{#if v.spoiler_text}<div class="hist-cw"><Emoji texto={v.spoiler_text} emojis={v.emojis} /></div>{/if}
			<div class="body"><Corpo html={v.content} emojis={v.emojis} /></div>
		</div>
	{/each}
</div>
