<script>
	import Estado from './Estado.svelte';

	// Fim de uma lista paginada: carregando, erro, vazio, "Fim." ou "Carregar mais".
	let { st, aoMais, aoTentar } = $props();
</script>

{#if st.loading}
	<Estado carregando />
{:else if st.error}
	<Estado erro={st.error} {aoTentar} />
{:else if !st.items.length}
	<Estado vazio="Nada por aqui ainda." />
{:else if !st.more}
	<p class="empty">Fim.</p>
{:else}
	<button type="button" class="ro-botao more" onclick={aoMais}>Carregar mais</button>
{/if}
