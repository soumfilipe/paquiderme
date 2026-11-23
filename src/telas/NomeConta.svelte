<script>
	import Emoji from './Emoji.svelte';

	// Nome de exibição de uma conta, com os emojis personalizados dela.
	let { conta } = $props();
</script>

<span><Emoji texto={conta.display_name || conta.username} emojis={conta.emojis} /></span>
