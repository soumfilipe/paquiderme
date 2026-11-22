<script>
	import Publicacao from './Publicacao.svelte';
	import Estado from './Estado.svelte';
	import ContaLinha from './ContaLinha.svelte';
	import TagLinha from './TagLinha.svelte';

	// Resultados da busca. `s`: estado reativo da busca ({ type, res, loading, error, more }).
	let { s, c, aoMais, aoTentar } = $props();
</script>

{#if s.error}
	<Estado erro={s.error} {aoTentar} />
{:else if s.loading && !s.res}
	<Estado vazio="Buscando…" />
{:else if s.res}
	{#if !s.res.accounts.length && !s.res.hashtags.length && !s.res.statuses.length}
		<Estado vazio="Nada encontrado." />
	{/if}
	{#if s.res.accounts.length}
		{#if !s.type}<h3 class="ro-rotulo section">Contas</h3>{/if}
		{#each s.res.accounts as a (a.id)}<ContaLinha {a} {c} />{/each}
	{/if}
	{#if s.res.hashtags.length}
		{#if !s.type}<h3 class="ro-rotulo section">Hashtags</h3>{/if}
		{#each s.res.hashtags as tag (tag.name)}<TagLinha {tag} {c} />{/each}
	{/if}
	{#if s.res.statuses.length}
		{#if !s.type}<h3 class="ro-rotulo section">Publicações</h3>{/if}
		{#each s.res.statuses as st (st.id)}<Publicacao s={st} {c} />{/each}
	{/if}
	{#if s.type && s.more}<button type="button" class="ro-botao more" onclick={aoMais}>{s.loading ? 'Carregando…' : 'Carregar mais'}</button>{/if}
{/if}
