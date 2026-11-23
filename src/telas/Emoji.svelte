<script module>
	import { safeUrl } from '../../lib.js';

	/** Divide um texto em pedaços de texto e emojis personalizados (:codigo:) da instância. */
	export function partes(texto, emojis) {
		const mapa = new Map((emojis || []).map((e) => [e.shortcode, e]));
		if (!mapa.size) return [{ t: texto }];
		const saida = [];
		let ultimo = 0;
		for (const m of texto.matchAll(/:([a-zA-Z0-9_]+):/g)) {
			const e = mapa.get(m[1]);
			const url = e && safeUrl(e.static_url || e.url);
			if (!url) continue;
			if (m.index > ultimo) saida.push({ t: texto.slice(ultimo, m.index) });
			saida.push({ url, codigo: `:${m[1]}:` });
			ultimo = m.index + m[0].length;
		}
		if (ultimo < texto.length) saida.push({ t: texto.slice(ultimo) });
		return saida;
	}
</script>

<script>
	// Texto com emojis personalizados da instância (nomes, avisos de conteúdo, opções de enquete).
	let { texto = '', emojis = [] } = $props();
	const lista = $derived(partes(texto, emojis));
</script>

{#each lista as p}{#if p.url}<img class="emoji" src={p.url} alt={p.codigo} title={p.codigo} loading="lazy" />{:else}{p.t}{/if}{/each}
