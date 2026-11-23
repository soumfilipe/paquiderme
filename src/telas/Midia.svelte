<script>
	import { safeUrl } from '../../lib.js';

	// Anexos de uma publicação. `sensivel`: esconde até o primeiro toque. `abrirVisualizador(itens, inicio)` abre a galeria.
	let { anexos, sensivel = false, abrirVisualizador } = $props();
	const itens = $derived((anexos || []).filter((m) => safeUrl(m.url)));
	const imagens = $derived(itens.filter((x) => x.type === 'image'));
	let revelada = $state(false);
	const oculta = $derived(sensivel && !revelada);

	function abrir(ev, m) {
		if (oculta) return; // o primeiro toque só revela
		ev.stopPropagation();
		abrirVisualizador(imagens.map((x) => ({ full: safeUrl(x.url), alt: x.description || '' })), imagens.indexOf(m));
	}
</script>

{#if itens.length}
	<div class="media" class:one={itens.length === 1} class:sensitive={oculta} title={oculta ? 'Conteúdo sensível — toque para mostrar' : undefined}
		role="presentation" onclick={() => { if (oculta) revelada = true; }}>
		{#each itens as m (m.id || m.url)}
			{@const src = safeUrl(m.url)}
			{@const previa = safeUrl(m.preview_url || '')}
			{#if m.type === 'image'}
				<img src={previa || src} alt={m.description || ''} loading="lazy" class="zoomable" onclick={(ev) => abrir(ev, m)} />
			{:else if m.type === 'gifv'}
				<video {src} poster={previa || null} autoplay loop muted playsinline></video>
			{:else if m.type === 'video'}
				<video {src} poster={previa || null} controls playsinline preload="metadata"></video>
			{:else if m.type === 'audio'}
				<audio {src} controls preload="none"></audio>
			{:else}
				<a href={src} target="_blank" rel="noopener noreferrer">{m.description || 'Anexo'}</a>
			{/if}
		{/each}
	</div>
{/if}
