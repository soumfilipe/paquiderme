<script>
	import { BotaoConfirmar } from 'rochedo/svelte';
	import NovaLista from './NovaLista.svelte';
	import Estado from './Estado.svelte';

	// Gerenciar listas. `L`: state.lists { items, error, loading, loaded }; `e`: { editing }.
	// aoCriar, aoAbrir(l), aoMembros(l), aoRenomear(l, titulo), aoExcluir(l), aoEditar(id|null), aoRecarregar ficam no app.
	let { L, e, aoCriar, aoAbrir, aoMembros, aoRenomear, aoExcluir, aoEditar, aoRecarregar } = $props();
	let novoNome = $derived(L.items.find((l) => l.id === e.editing)?.title ?? '');
</script>

<NovaLista {aoCriar} />
{#if L.error}
	<Estado erro={L.error} aoTentar={aoRecarregar} />
{:else if L.loading && !L.loaded}
	<Estado carregando />
{:else if !L.items.length}
	<Estado vazio="Você ainda não tem listas. Crie uma acima e adicione contas que você segue." />
{/if}
{#each L.items as l (l.id)}
	{#if e.editing === l.id}
		<form
			class="list-row"
			onsubmit={(ev) => {
				ev.preventDefault();
				if (novoNome.trim()) aoRenomear(l, novoNome.trim());
			}}
		>
			<input bind:value={novoNome} maxlength="100" aria-label="Novo nome da lista" />
			<button type="submit" class="ro-botao ro-botao--principal">Salvar</button>
			<button type="button" class="ro-botao" onclick={() => aoEditar(null)}>Cancelar</button>
		</form>
	{:else}
		<div class="list-row">
			<button type="button" class="list-title link" onclick={() => aoAbrir(l)}>{l.title}</button>
			<button type="button" class="ro-botao" onclick={() => aoMembros(l)}>Membros</button>
			<button type="button" class="ro-botao" onclick={() => aoEditar(l.id)}>Renomear</button>
			<BotaoConfirmar rotulo="Confirmar" aoConfirmar={() => aoExcluir(l)}>Excluir</BotaoConfirmar>
		</div>
	{/if}
{/each}
