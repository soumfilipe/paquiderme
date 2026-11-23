<script>
	import { compose, limites, ui } from '../composicao.svelte.js';
	import Ico from './Ico.svelte';

	// Barra de ferramentas do compositor. As ações que usam API, folhas ou o campo de texto vêm do app.
	let { visibilidades, idiomas, aoVisibilidade, aoAviso, aoAnexos, aoEnquete, aoAgendar, aoIdioma } = $props();
	let arquivos;

	const visAtual = $derived(visibilidades.find(([id]) => id === ui.vis) || visibilidades[0]);
	const idioma = $derived(idiomas.find(([c]) => c === compose.lang));
	const quando = $derived(compose.scheduledAt ? `Agendada para ${new Date(compose.scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Agendar publicação');
	const semMidia = $derived(!!compose.poll || compose.media.length >= limites.maxMedia || (compose.edit && !!compose.edit.poll));
	const semEnquete = $derived(!!compose.media.length || !!compose.edit);
</script>

<div class="menu-wrap" hidden={!!compose.edit}>
	<button type="button" class="tool" id="vis-btn" aria-haspopup="menu" aria-expanded={ui.visMenu} aria-label="Visibilidade" title={visAtual[1]} onclick={() => (ui.visMenu = !ui.visMenu)}>
		<Ico nome={'vis-' + ui.vis} tamanho={22} /><Ico nome="chev" tamanho={14} />
	</button>
	<div id="vis-menu" role="menu" hidden={!ui.visMenu}>
		{#each visibilidades as [id, rotulo, desc] (id)}
			<button type="button" role="menuitemradio" aria-checked={id === ui.vis} onclick={() => aoVisibilidade(id)}>
				<Ico nome={'vis-' + id} tamanho={22} /><span>{rotulo}<small>{desc}</small></span>{#if id === ui.vis}<Ico nome="check" tamanho={18} />{:else}<span></span>{/if}
			</button>
		{/each}
	</div>
</div>
<button type="button" class="tool" id="cw-btn" aria-pressed={ui.cwOn} aria-label="Aviso de conteúdo" onclick={aoAviso}><Ico nome="warn" tamanho={22} /></button>
<button type="button" class="tool" id="media-btn" aria-label="Anexar foto ou vídeo" disabled={semMidia} onclick={() => arquivos.click()}><Ico nome="image" tamanho={22} /></button>
<button type="button" class="tool" id="poll-btn" aria-pressed={!!compose.poll} aria-label="Enquete" disabled={semEnquete} onclick={aoEnquete}><Ico nome="poll" tamanho={22} /></button>
<button type="button" class="tool" id="sched-btn" class:active={!!compose.scheduledAt} aria-pressed={!!compose.scheduledAt} aria-label="Agendar publicação" title={quando} hidden={!!compose.edit} onclick={aoAgendar}><Ico nome="clock" tamanho={22} /></button>
<button type="button" class="tool" id="lang-btn" aria-pressed={!!compose.lang} aria-label="Idioma da publicação" title={idioma ? idioma[1] : compose.lang} onclick={aoIdioma}>
	<Ico nome="language" tamanho={22} />{#if compose.lang}<span class="tool-badge">{compose.lang.toUpperCase()}</span>{/if}
</button>
<input type="file" id="media-input" accept="image/*,video/*,audio/*" multiple hidden bind:this={arquivos} onchange={(ev) => { const fs = [...ev.target.files]; ev.target.value = ''; aoAnexos(fs); }} />
<button type="submit" class="ro-botao ro-botao--principal" id="post-btn" disabled={ui.publicando}>Publicar</button>
