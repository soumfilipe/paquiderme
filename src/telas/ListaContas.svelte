<script>
	import ContaLinha from './ContaLinha.svelte';
	import RodapeLista from './RodapeLista.svelte';

	// Seguidores / seguindo de uma conta. `st`: lista reativa paginada.
	let { st, c, aoMais, aoTentar } = $props();
</script>

{#each st.items as a (a.id)}<ContaLinha {a} {c} />{/each}
<RodapeLista {st} {aoMais} {aoTentar} />
