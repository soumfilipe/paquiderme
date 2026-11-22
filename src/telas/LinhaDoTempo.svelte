<script>
	import Publicacao from './Publicacao.svelte';
	import Estado from './Estado.svelte';

	// Lista de publicações (home, listas, local, global, hashtag, perfis, outra instância).
	// `st` é a entrada do estado reativo ({ items, more, loading, error, cached, cachedAt }): carregar, paginar ou chegar
	// uma publicação nova muda só o que mudou, sem reconstruir a tela.
	let { st, readonly = false, host = null, ocultar = null, c, aoMais, aoTentar } = $props();

	// sem repetidas: uma publicação que chegou ao vivo pode vir de novo na próxima página
	const visiveis = $derived.by(() => {
		const vistos = new Set();
		return st.items.filter((it) => !vistos.has(it.id) && vistos.add(it.id) && !(ocultar && ocultar(it)));
	});
	const quandoGuardou = $derived(st.cachedAt ? new Date(st.cachedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
</script>

{#if st.cached}
	<p class="cache-note" role="status">
		{st.error ? `Sem conexão. Mostrando o que foi guardado em ${quandoGuardou}.` : `Mostrando o que foi guardado em ${quandoGuardou}. Atualizando…`}
	</p>
{/if}

{#each visiveis as it (it.id)}
	<Publicacao s={it} {readonly} {host} {c} />
{/each}

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
