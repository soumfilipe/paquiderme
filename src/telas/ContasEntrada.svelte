<script>
	import LinhaConta from './LinhaConta.svelte';
	import Estado from './Estado.svelte';

	// Contas silenciadas / bloqueadas. `e`: { items, error, loading, more, undoLabel }.
	// aoDesfazer(conta, botao), aoMais(anexar) e aoRecarregar() ficam por conta do app.
	let { e, c, aoDesfazer, aoMais, aoRecarregar } = $props();
</script>

{#each e.items as a (a.id)}
	<LinhaConta conta={a} rotulo={e.undoLabel} {c} aoClicar={(btn) => aoDesfazer(a, btn)} />
{/each}
{#if e.error}
	<Estado erro={e.error} aoTentar={aoRecarregar} />
{:else if e.loading}
	<Estado carregando />
{:else if !e.items.length}
	<Estado vazio="Ninguém por aqui." />
{:else if e.more}
	<button type="button" class="ro-botao more" onclick={aoMais}>Carregar mais</button>
{/if}
