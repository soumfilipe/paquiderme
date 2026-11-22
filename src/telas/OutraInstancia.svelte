<script>
	// Cabeçalho de "Outras instâncias": endereço, instâncias salvas e aviso. A lista de publicações vem depois, no app.
	let { host, salvas, aoIr } = $props();
	let texto = $state(host);
</script>

<form class="inst-form" onsubmit={(ev) => { ev.preventDefault(); aoIr(texto); }}>
	<input bind:value={texto} placeholder="ex.: mastodon.social" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="url" aria-label="Endereço da instância" />
	<button type="submit" class="ro-botao ro-botao--principal">Ver</button>
</form>
{#if salvas.length}
	<div class="hosts">
		{#each salvas as s (s)}
			<button type="button" class="chip ro-chip" aria-pressed={s === host} onclick={() => aoIr(s)}>{s}</button>
		{/each}
	</div>
{/if}
<p class="note muted small">Mostra a timeline local pública da instância escolhida, só para leitura. Para interagir, abra o original.</p>
