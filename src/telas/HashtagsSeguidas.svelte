<script>
	import Estado from './Estado.svelte';

	// Hashtags que a pessoa segue. `f`: { items, loaded, error }.
	let { f, aoAbrir, aoDeixar, aoTentar } = $props();
</script>

{#if f.error}
	<Estado erro={f.error} {aoTentar} />
{:else if !f.loaded}
	<Estado carregando />
{:else if !f.items.length}
	<Estado vazio="Você ainda não segue hashtags. Abra uma hashtag e toque em Seguir: as publicações dela passam a aparecer no Início." />
{:else}
	{#each f.items as t (t.name)}
		<div class="tag-row">
			<button type="button" class="tag-name" onclick={() => aoAbrir(t.name)}>#{t.name}</button>
			<button class="ro-botao" type="button" onclick={() => aoDeixar(t.name)}>Deixar de seguir</button>
		</div>
	{/each}
{/if}
