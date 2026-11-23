<script>
	import NomeConta from './NomeConta.svelte';
	import Ico from './Ico.svelte';

	// Barra do topo de uma tela empilhada (Rochedo: `.ro-cabecalho--barra`). `titulo` é texto ou um nó de DOM (nome com emojis).
	// `acoes`: botões à direita ([{ aria, icone, aoClicar }]).
	let { titulo, aoVoltar = null, acoes = [] } = $props();
</script>

<header class="ro-cabecalho ro-cabecalho--barra profile-bar">
	{#if aoVoltar}
		<button type="button" class="ro-botao ro-botao--quieto ro-botao--icone icon-btn" aria-label="Voltar" onclick={aoVoltar}><Ico nome="back" tamanho={22} /></button>
	{/if}
	<strong class="ro-cabecalho__titulo">{#if typeof titulo === 'string'}{titulo}{:else}<NomeConta conta={titulo.conta} />{/if}</strong>
	{#if acoes.length}
		<span class="push-right bar-actions">
			{#each acoes as a (a.aria)}
				<button type="button" class="ro-botao ro-botao--quieto ro-botao--icone icon-btn" aria-label={a.aria} onclick={a.aoClicar}><Ico nome={a.icone} tamanho={22} /></button>
			{/each}
		</span>
	{/if}
</header>
