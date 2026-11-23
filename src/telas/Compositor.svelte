<script>
	import { onMount } from 'svelte';
	import { ui, limites } from '../composicao.svelte.js';
	import { arrastarParaFechar, bloquearRolagemDeFundo, acompanharTeclado } from '../composicaoGestos.js';
	import ComposicaoExtras from './ComposicaoExtras.svelte';
	import ComposicaoSugestoes from './ComposicaoSugestoes.svelte';
	import ComposicaoFerramentas from './ComposicaoFerramentas.svelte';

	// O corpo do compositor (dentro do <dialog id="composer">): alça, aviso, texto, anexos/enquete, sugestões e ferramentas.
	// O texto e o aviso moram em `ui.texto`/`ui.cw`; os ids ficam como estavam (#text, #cw…). `c` traz o que depende do app.
	let { c } = $props();

	onMount(() => {
		const sair1 = bloquearRolagemDeFundo();
		const sair2 = acompanharTeclado();
		return () => { sair1(); sair2(); };
	});

	// o contador e a altura do campo acompanham o texto
	$effect(() => {
		ui.chars = ui.texto.length;
		c.ajustarTexto();
	});
</script>

<form method="dialog" id="compose-form" onsubmit={c.aoEnviar}>
	<div class="compose-head" id="compose-head" use:arrastarParaFechar>
		<button type="button" id="cancel-compose" aria-label="Fechar o compositor (ou deslize para baixo)" onclick={(e) => { if (e.detail === 0) document.getElementById('composer').close(); }}><span class="grabber"></span></button>
	</div>
	<div class="compose-body" id="compose-body">
		<p id="reply-to" class="muted small" hidden={!ui.nota}>{ui.nota}</p>
		<input id="cw" placeholder="Aviso de conteúdo" maxlength="200" hidden={!ui.cwOn} bind:value={ui.cw} oninput={c.rascunho}>
		<textarea id="text" placeholder="No que você está pensando?" maxlength={ui.max} disabled={ui.bloqueado} bind:value={ui.texto}
			oninput={c.aoDigitar} onkeyup={(e) => { if (e.key.startsWith('Arrow')) c.aoCursor(); }} onclick={c.aoCursor}></textarea>
		<div id="compose-extras" style="display: contents"><ComposicaoExtras removerMidia={c.removerMidia} editarAlt={c.editarAlt} rascunho={c.rascunho} /></div>
	</div>
	<div id="suggest" class="suggest" hidden={!ui.sugestoes.length} onpointerdown={(e) => e.preventDefault()}>
		<ComposicaoSugestoes escolher={c.escolherSugestao} seguro={c.seguro} />
	</div>
	<p id="compose-error" class="error ro-faixa ro-faixa--erro" role="alert">{ui.erro}</p>
	<!-- os botões da barra não tiram o foco do texto (o teclado não fecha) -->
	<div class="compose-tools" id="compose-tools" onpointerdown={(e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); }}>
		<ComposicaoFerramentas {...c.ferramentas} />
	</div>
</form>
