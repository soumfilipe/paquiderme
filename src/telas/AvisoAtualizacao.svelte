<script>
	import { atualizacao, aplicarAtualizacao, dispensarAtualizacao } from '../atualizacao.svelte.js';
	import { Icone } from 'rochedo/svelte';

	const visivel = $derived(atualizacao.disponivel && !atualizacao.dispensada);
</script>

<!-- A região existe sempre, para leitores de tela anunciarem quando o aviso aparece. -->
<div class="regiao" role="status" aria-live="polite">
	{#if visivel}
		<div class="aviso">
			<span class="texto">nova versão do app</span>
			<button type="button" class="ro-botao ro-botao--principal" onclick={aplicarAtualizacao} disabled={atualizacao.aplicando}>
				{atualizacao.aplicando ? 'atualizando…' : 'atualizar'}
			</button>
			<button type="button" class="ro-botao ro-botao--quieto ro-botao--icone" aria-label="atualizar depois" onclick={dispensarAtualizacao}>
				<Icone nome="close" tamanho={18} />
			</button>
		</div>
	{/if}
</div>

<style>
	/* Logo acima da barra de abas. */
	.regiao {
		position: fixed;
		left: 12px;
		right: 12px;
		bottom: calc(var(--tabbar-h) + var(--sab) + 12px);
		z-index: 20;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.aviso {
		pointer-events: auto;
		width: 100%;
		max-width: 560px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 6px 6px 16px;
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--surface);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
	}
	.texto {
		flex: 1;
		font-size: 15px;
	}
</style>
