<script>
	import Ico from './Ico.svelte';

	// Barra de abas fixa no topo da tela (trilho do Rochedo, `.ro-abas`). `acao` opcional: um botão no fim do trilho.
	let { itens, valor, aoMudar, nome = 'abas', sob = false, acao = null } = $props();
	let trilho;

	// a aba atual vem para o centro quando o trilho rola
	$effect(() => {
		valor;
		const atual = trilho?.querySelector('[aria-selected="true"]');
		if (atual) trilho.scrollLeft = atual.offsetLeft - (trilho.clientWidth - atual.clientWidth) / 2;
	});
</script>

<div class="seg-bar" class:under={sob}>
	<div bind:this={trilho} class="tabs ro-abas" role="tablist" aria-label={nome}>
		{#each itens as it (it.id)}
			<button type="button" role="tab" aria-selected={it.id === valor} onclick={() => aoMudar(it.id)}>{it.rotulo}</button>
		{/each}
		{#if acao}
			<button type="button" class="with-icon" aria-label={acao.aria} onclick={acao.aoClicar}><Ico nome={acao.icone} tamanho={16} />{acao.rotulo}</button>
		{/if}
	</div>
</div>
