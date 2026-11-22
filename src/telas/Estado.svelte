<script>
	/** Carregando, erro com "tentar de novo" ou vazio (estados do Rochedo). Passe só o que vale no momento. */
	let { carregando = false, erro = null, aoTentar, vazio = null, rotulo = 'Carregando…' } = $props();
</script>

{#if erro}
	<div class="ro-estado ro-estado--erro" role="alert">
		<p class="ro-estado__titulo">Não deu certo</p>
		<p>{erro}</p>
		<button type="button" class="ro-botao" onclick={aoTentar}>Tentar de novo</button>
	</div>
{:else if carregando}
	<div class="ro-carregando" aria-busy="true" aria-label={rotulo}><i></i><i></i><i></i></div>
{:else if vazio}
	<div class="ro-estado"><p class="ro-estado__titulo">{vazio}</p></div>
{/if}
