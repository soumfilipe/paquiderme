<script>
	import LinhaConta from './LinhaConta.svelte';
	import Estado from './Estado.svelte';

	// Membros de uma lista, com busca entre quem você segue. `e`: { list, items, results, q, loaded, loading, error }.
	let { e, c, aoBuscar, aoAdicionar, aoRemover, aoRecarregar } = $props();
	let consulta = $state(e.q ?? '');
	const ids = $derived(new Set(e.items.map((m) => m.id)));
</script>

<form
	class="inst-form"
	onsubmit={(ev) => {
		ev.preventDefault();
		aoBuscar(consulta.trim());
	}}
>
	<input bind:value={consulta} placeholder="Buscar entre quem você segue" autocapitalize="none" autocorrect="off" spellcheck="false" aria-label="Buscar contas que você segue" />
	<button type="submit" class="ro-botao ro-botao--principal">Buscar</button>
</form>

{#if e.results}
	<h3 class="ro-rotulo section">Resultados</h3>
	{#if !e.results.length}<Estado vazio="Ninguém encontrado entre quem você segue." />{/if}
	{#each e.results as a (a.id)}
		<LinhaConta conta={a} rotulo={ids.has(a.id) ? 'Na lista' : 'Adicionar'} {c} aoClicar={(btn) => !ids.has(a.id) && aoAdicionar(a, btn)} />
	{/each}
{/if}

<h3 class="ro-rotulo section">Membros{e.loaded ? ` (${e.items.length})` : ''}</h3>
{#if e.error}
	<Estado erro={e.error} aoTentar={aoRecarregar} />
{:else if e.loading && !e.loaded}
	<Estado carregando />
{:else if !e.items.length}
	<Estado vazio="Lista vazia. Busque acima uma conta que você segue." />
{/if}
{#each e.items as a (a.id)}
	<LinhaConta conta={a} rotulo="Remover" {c} aoClicar={(btn) => aoRemover(a, btn)} />
{/each}
