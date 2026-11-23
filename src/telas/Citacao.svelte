<script>
	import { safeUrl } from '../../lib.js';
	import NomeConta from './NomeConta.svelte';
	import NoDom from './NoDom.svelte';

	// Publicação citada. `c`: abrirConversa(status, host), html(texto, emojis).
	let { q, host = null, c } = $props();
	const qs = $derived(q.quoted_status);
	const aceita = $derived(!!qs && q.state === 'accepted');
	const motivo = $derived({ pending: 'Citação aguardando aprovação', rejected: 'Citação não autorizada', revoked: 'Citação removida', deleted: 'Publicação citada excluída', unauthorized: 'Publicação citada indisponível', blocked_account: 'Publicação de conta bloqueada', blocked_domain: 'Publicação de domínio bloqueado', muted_account: 'Publicação de conta silenciada' }[q.state]);
	const abrir = () => c.abrirConversa(qs, host);
</script>

{#if !aceita}
	{#if motivo}<div class="quote muted small">{motivo}</div>{/if}
{:else}
	{@const a = qs.account}
	<div class="quote" role="button" tabindex="0" onclick={abrir} onkeydown={(e) => e.key === 'Enter' && abrir()}>
		<div class="quote-head">
			<img class="ro-avatar avatar sm" src={safeUrl(a.avatar_static || a.avatar)} alt="" loading="lazy" />
			<strong><NomeConta conta={a} /></strong><span class="acct">@{a.acct}</span>
		</div>
		{#if qs.spoiler_text}<p class="muted small">{qs.spoiler_text}</p>{:else}<div class="quote-body"><NoDom no={c.html(qs.content, qs.emojis)} /></div>{/if}
	</div>
{/if}
