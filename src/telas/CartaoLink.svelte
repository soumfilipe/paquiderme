<script>
	import { safeUrl } from '../../lib.js';

	// Cartão de pré-visualização de um link (card da API). Não mostra nada sem endereço ou sem título/descrição.
	let { card } = $props();
	const host = $derived.by(() => { try { return new URL(card.url).hostname.replace(/^www\./, ''); } catch { return ''; } });
	const mostrar = $derived(!!card && !!card.url && !!(card.title || card.description) && !!host);
</script>

{#if mostrar}
	<a class="link-card" class:no-img={!card.image} href={safeUrl(card.url)} target="_blank" rel="noopener noreferrer">
		{#if card.image}<img class="card-img" src={safeUrl(card.image)} alt="" loading="lazy" width={card.width || null} height={card.height || null} />{/if}
		<div class="card-text">
			<span class="card-site">{card.provider_name || host}</span>
			<strong class="card-title">{card.title || host}</strong>
			{#if card.description}<span class="card-desc">{card.description}</span>{/if}
		</div>
	</a>
{/if}
