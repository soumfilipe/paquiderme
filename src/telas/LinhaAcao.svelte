<script>
	/** Linha de lista com informação à esquerda (children) e ações embaixo (snippet `acoes`). */
	let { children, acoes } = $props();
</script>

<div class="linha">
	<div class="info">{@render children()}</div>
	<div class="acoes">{@render acoes()}</div>
</div>

<style>
	.linha {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.info :global(.small) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.acoes {
		display: flex;
		gap: 8px;
	}
</style>
