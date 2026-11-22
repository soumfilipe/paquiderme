<script>
	import NoDom from './NoDom.svelte';

	/** Hashtag em alta: pessoas e usos dos últimos 2 dias e a linha dos últimos 7. */
	let { tag, c } = $props();
	const hist = $derived(tag.history || []);
	const dois = $derived(hist.slice(0, 2));
	const pessoas = $derived(dois.reduce((n, d) => n + Number(d.accounts || 0), 0));
	const usos = $derived(dois.reduce((n, d) => n + Number(d.uses || 0), 0));
	const linha = $derived(c.sparkline(hist.slice(0, 7).map((d) => Number(d.uses || 0)).reverse()));
</script>

<button type="button" class="ro-linha tag-row" onclick={() => c.openTag(tag.name)}>
	<span class="ro-linha__corpo">
		<span class="ro-linha__titulo">#{tag.name}</span>
		<span class="ro-linha__sub">{pessoas} pessoas · {usos} publicações nos últimos 2 dias</span>
	</span>
	<span class="ro-linha__fim"><NoDom no={linha} /></span>
</button>
