<script>
	// Filtro por tipo de resultado da busca.
	let { tipos, atual, aoEscolher } = $props();
</script>

<div class="hosts" role="group" aria-label="Tipo de resultado">
	{#each tipos as [id, rotulo] (id)}
		<button type="button" class="chip ro-chip" aria-pressed={atual === id} onclick={() => aoEscolher(id)}>{rotulo}</button>
	{/each}
</div>
