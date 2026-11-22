<script>
	import { Icone } from 'rochedo/svelte';
	import NoDom from './NoDom.svelte';
	import Estado from './Estado.svelte';

	// Em quais listas uma conta aparece. `e`: { member (Set), loaded, error }; `listas`: state.lists.items.
	// criarForm() devolve o formulário de nova lista (feito em JS); alternar(lista, estavaNela, botao) chama a API.
	let { e, listas, criarForm, alternar, aoRecarregar } = $props();
</script>

<NoDom no={criarForm()} />
{#if e.error}
	<Estado erro={e.error} aoTentar={aoRecarregar} />
{:else if !e.loaded}
	<Estado carregando />
{:else if !listas.length}
	<Estado vazio="Crie uma lista acima para começar." />
{/if}
{#if e.loaded}
	{#each listas as l (l.id)}
		{@const nela = e.member.has(l.id)}
		<button type="button" class="pick-row" class:on={nela} role="switch" aria-checked={nela} onclick={(ev) => alternar(l, nela, ev.currentTarget)}>
			<span class="pick-box">{#if nela}<Icone nome="check" tamanho={16} />{/if}</span>{l.title}
		</button>
	{/each}
{/if}
