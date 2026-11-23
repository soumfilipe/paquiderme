<script>
	import { untrack } from 'svelte';
	import { desmontarIlhas } from '../ilhas.js';
	import { gatilho } from '../casca.svelte.js';

	// Hospeda uma tela que o app ainda monta em JS (`fn(elemento)`). Refaz-se quando o gatilho muda — o antigo render().
	// `pular()` devolve true para manter a tela como está (ex.: formulário em edição com o teclado aberto).
	let { fn, pular = () => false } = $props();
	let el;

	$effect(() => {
		gatilho.v;
		untrack(() => {
			if (el.childElementCount && pular()) return;
			const y = window.scrollY;
			desmontarIlhas();
			el.replaceChildren();
			fn(el);
			window.scrollTo(0, y);
		});
	});
	$effect(() => () => desmontarIlhas());
</script>

<div bind:this={el} style="display: contents"></div>
