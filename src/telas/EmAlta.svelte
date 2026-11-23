<script>
	import Publicacao from './Publicacao.svelte';
	import Estado from './Estado.svelte';
	import ContaLinha from './ContaLinha.svelte';
	import TagLinha from './TagLinha.svelte';
	import Corpo from './Corpo.svelte';
	import CartaoLink from './CartaoLink.svelte';

	// Aba "Em alta": avisos da instância, sugestões de contas, links, hashtags e publicações. `t`: estado reativo de trends.
	let { t, c, aoTentar, aoDispensar } = $props();
	const links = $derived(t.links.filter((l) => l && l.url && (l.title || l.description)));
</script>

{#if t.error}
	<Estado erro={t.error} {aoTentar} />
{:else if t.loading && !t.loaded}
	<Estado carregando />
{:else}
	{#each t.notices as n (n.id)}
		<div class="notice">
			<div class="notice-body"><Corpo html={n.content} emojis={n.emojis} /></div>
			<button type="button" class="link" onclick={() => aoDispensar(n)}>Dispensar</button>
		</div>
	{/each}
	{#if t.people.length}
		<h3 class="ro-rotulo section">Sugestões de contas</h3>
		{#each t.people.filter((p) => p.account) as p (p.account.id)}<ContaLinha a={p.account} {c} />{/each}
	{/if}
	{#if links.length}
		<h3 class="ro-rotulo section">Links em alta</h3>
		{#each links as l (l.url)}<div class="trend-link"><CartaoLink card={l} /></div>{/each}
	{/if}
	<h3 class="ro-rotulo section">Hashtags em alta</h3>
	{#if !t.tags.length}<Estado vazio="Nenhuma hashtag em alta agora." />{/if}
	{#each t.tags as tag (tag.name)}<TagLinha {tag} {c} />{/each}
	{#if t.statuses.length}
		<h3 class="ro-rotulo section">Publicações em alta</h3>
		{#each t.statuses as s (s.id)}<Publicacao {s} {c} />{/each}
	{/if}
{/if}
