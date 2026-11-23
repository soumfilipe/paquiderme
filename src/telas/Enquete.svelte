<script>
	import Emoji from './Emoji.svelte';
	import Ico from './Ico.svelte';

	// Enquete de uma publicação: votar, ver resultado e atualizar.
	// `c`: eu (id da conta do app), votar(enquete, escolhas), atualizar(enquete), restante(iso), toast(msg).
	let { s, somenteLeitura = false, c } = $props();
	const p = $derived(s.poll);
	const meu = $derived(s.account.id === c.eu());
	const contagens = $derived(p.options.every((o) => o.votes_count != null));
	const mostrarBarras = $derived(contagens && (somenteLeitura || p.voted || p.expired || p.options.some((o) => o.votes_count > 0) || meu));
	const podeVotar = $derived(!somenteLeitura && !p.voted && !p.expired && !meu);
	const base = $derived((p.multiple ? p.voters_count : p.votes_count) || p.votes_count || 0);
	const minhas = $derived(new Set(p.own_votes || []));
	const votos = $derived(p.voters_count != null ? p.voters_count : p.votes_count);
	const meta = $derived([`${votos == null ? '?' : votos} ${votos === 1 ? 'voto' : 'votos'}`, p.expired ? 'encerrada' : c.restante(p.expires_at)].join(' · '));

	let escolhidas = $state([]);
	let enviando = $state(false);

	function alternar(i) {
		if (p.multiple) escolhidas = escolhidas.includes(i) ? escolhidas.filter((x) => x !== i) : [...escolhidas, i];
		else escolhidas = [i];
	}
	async function votar() {
		enviando = true;
		try { await c.votar(s, escolhidas); } catch (e) { c.toast(e.message); } finally { enviando = false; }
	}
	async function atualizar() {
		try { await c.atualizarEnquete(s); } catch (e) { c.toast(e.message); }
	}
</script>

<div class="poll">
	{#if podeVotar}
		{#each p.options as o, i (i)}
			{@const on = escolhidas.includes(i)}
			<button type="button" class="poll-choice" class:on role={p.multiple ? 'checkbox' : 'radio'} aria-checked={on ? 'true' : 'false'} onclick={() => alternar(i)}>
				<span class="pick-box" class:round={!p.multiple}>{#if on}<Ico nome="check" tamanho={14} />{/if}</span><Emoji texto={o.title} emojis={p.emojis} />
			</button>
		{/each}
		<button type="button" class="ro-botao ro-botao--principal" disabled={escolhidas.length === 0 || enviando} onclick={votar}>Votar</button>
	{:else}
		{#each p.options as o, i (i)}
			{@const pct = mostrarBarras && base ? Math.round((o.votes_count / base) * 100) : 0}
			<div class="poll-row" class:mine={minhas.has(i)}>
				{#if mostrarBarras}<span class="poll-bar" style="width:{pct}%"></span>{/if}
				<span class="poll-label">{#if minhas.has(i)}<Ico nome="check" tamanho={14} />{/if}<Emoji texto={o.title} emojis={p.emojis} /></span>
				{#if mostrarBarras}<span class="poll-pct">{pct}%</span>{/if}
			</div>
		{/each}
	{/if}
	<div class="poll-foot muted small">{meta}{#if !somenteLeitura && !p.expired} · <button type="button" class="link" onclick={atualizar}>Atualizar</button>{/if}</div>
</div>
