<script>
	/** Põe um nó do DOM (feito pelo app em JS, como nome com emojis) dentro do Svelte. */
	let { no } = $props();
	let alvo;
	$effect(() => {
		alvo.replaceChildren(no);
	});
</script>

<span bind:this={alvo}></span>
