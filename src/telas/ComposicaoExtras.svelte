<script>
	import { compose, limites, ui } from '../composicao.svelte.js';
	import Ico from './Ico.svelte';

	// Anexos, enquete e contador do compositor. Tudo lê de `compose`/`ui`; os callbacks do app fazem o que envolve API ou folhas.
	let { removerMidia, editarAlt, rascunho } = $props();

	const duracoes = $derived([[300, '5 min'], [1800, '30 min'], [3600, '1 h'], [21600, '6 h'], [86400, '1 dia'], [259200, '3 dias'], [604800, '7 dias']]
		.filter(([s]) => s >= limites.pollMin && s <= limites.pollMax));

	// duração que a instância não aceita: cai para a mais próxima de 1 dia
	$effect(() => {
		const p = compose.poll;
		if (p && !duracoes.some(([s]) => s === p.expires_in)) p.expires_in = (duracoes[Math.min(4, duracoes.length - 1)] || [86400])[0];
	});
</script>

{#if compose.media.length}
	<div id="compose-media" class="compose-media">
		{#each compose.media as m, i (m)}
			<div class="cm-item" class:loading={m.uploading}>
				{#if m.type === 'video' || m.type === 'gifv'}<div class="cm-video">▶</div>{:else}<img src={m.preview} alt={m.description || 'Anexo'} />{/if}
				{#if m.uploading}<span class="cm-spin"><Ico nome="refresh" tamanho={20} /></span>{/if}
				<button type="button" class="cm-x" aria-label="Remover anexo" onclick={() => removerMidia(i)}><Ico nome="close" tamanho={14} /></button>
				<button type="button" class="cm-alt" class:set={m.description} disabled={m.uploading} aria-label="Descrição para acessibilidade" onclick={() => editarAlt(m)}>ALT</button>
			</div>
		{/each}
	</div>
{/if}

{#if compose.poll}
	{@const p = compose.poll}
	<div id="compose-poll" class="compose-poll">
		{#each p.options as _, i (i)}
			<div class="cp-opt">
				<input bind:value={p.options[i]} maxlength={limites.pollChars} placeholder="Opção {i + 1}" aria-label="Opção {i + 1}" oninput={rascunho} />
				{#if p.options.length > 2}
					<button type="button" class="ro-botao ro-botao--quieto ro-botao--icone icon-btn" aria-label="Remover opção" onclick={() => { p.options.splice(i, 1); rascunho(); }}><Ico nome="close" tamanho={16} /></button>
				{/if}
			</div>
		{/each}
		<div class="cp-row">
			{#if p.options.length < limites.pollOptions}<button type="button" class="chip ro-chip" onclick={() => p.options.push('')}>+ Opção</button>{/if}
			<button type="button" class="chip ro-chip" aria-pressed={!!p.multiple} onclick={() => { p.multiple = !p.multiple; rascunho(); }}>Múltipla escolha</button>
		</div>
		<div class="cp-row" role="group" aria-label="Duração">
			{#each duracoes as [s, rotulo] (s)}
				<button type="button" class="chip ro-chip" aria-pressed={p.expires_in === s} onclick={() => { p.expires_in = s; rascunho(); }}>{rotulo}</button>
			{/each}
		</div>
	</div>
{/if}

<div class="compose-meta">
	{#if compose.media.length}
		<button type="button" class="chip ro-chip" id="sens-btn" class:active={compose.sensitive} aria-pressed={!!compose.sensitive} onclick={() => (compose.sensitive = !compose.sensitive)}>Mídia sensível</button>
	{/if}
	<span id="count" class="muted small">{ui.chars}/{ui.max}</span>
</div>
