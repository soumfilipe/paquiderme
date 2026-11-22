<script>
	import { svgIcon } from '../../lib.js';

	/** Ícone da biblioteca do app (classe `ico`, usada pelas animações das ações). */
	let { nome, tamanho = 22 } = $props();
	let alvo;
	$effect(() => {
		alvo.replaceChildren(svgIcon(nome, tamanho));
	});
</script>

<span bind:this={alvo} style="display: contents"></span>
