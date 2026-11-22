<script>
	import { Icone } from 'rochedo/svelte';

	// Criar ou editar um filtro. `e`: { filter, form, error }, `contextos` e `duracoes` são as listas de opções.
	// aoSalvar(form) valida e grava; lança Error(mensagem) se algo falhar. O formulário também é gravado de volta
	// em e.form a cada mudança, para sobreviver a uma reconstrução da tela.
	let { e, contextos, duracoes, aoSalvar } = $props();
	const f = e.form;

	let titulo = $state(f.title);
	let palavras = $state(f.words);
	let inteiras = $state(f.whole);
	let ctx = $state([...f.context]);
	let acao = $state(f.action);
	let exp = $state(f.exp);
	let erro = $state(e.error || '');
	let salvando = $state(false);

	$effect(() => {
		f.title = titulo;
		f.words = palavras;
		f.whole = inteiras;
		f.context = new Set(ctx);
		f.action = acao;
		f.exp = exp;
	});

	const manter = $derived(e.filter?.expires_at ? [['keep', `Manter (${new Date(e.filter.expires_at).toLocaleDateString('pt-BR')})`]] : []);
	const itensDuracao = $derived([...manter, ...duracoes]);
	const duracaoAtiva = (v) => (exp === undefined ? v === (e.filter?.expires_at ? 'keep' : '') : exp === v);

	const alternarCtx = (c) => (ctx = ctx.includes(c) ? ctx.filter((x) => x !== c) : [...ctx, c]);

	async function salvar() {
		salvando = true;
		erro = '';
		try {
			await aoSalvar(f);
		} catch (ex) {
			erro = ex.message;
			salvando = false;
		}
	}
</script>

<div class="edit-form">
	<label class="edit-field"><span class="muted small">Nome do filtro</span>
		<input bind:value={titulo} maxlength="100" placeholder="Ex.: Spoilers" autocomplete="off" />
	</label>
	<label class="edit-field"><span class="muted small">Palavras ou frases</span>
		<textarea bind:value={palavras} rows="5" placeholder="Uma palavra ou frase por linha" autocapitalize="none" spellcheck="false"></textarea>
	</label>
	<button type="button" class="pick-row" class:on={inteiras} role="switch" aria-checked={inteiras} onclick={() => (inteiras = !inteiras)}>
		<span class="pick-box">{#if inteiras}<Icone nome="check" tamanho={16} />{/if}</span>Só palavras inteiras
	</button>

	<strong>Onde vale</strong>
	<div class="cp-row">
		{#each contextos as [valor, rotulo] (valor)}
			<button type="button" class="chip ro-chip" aria-pressed={ctx.includes(valor)} onclick={() => alternarCtx(valor)}>{rotulo}</button>
		{/each}
	</div>
	<strong>O que fazer</strong>
	<div class="cp-row">
		{#each [['warn', 'Recolher com aviso'], ['hide', 'Ocultar']] as [valor, rotulo] (valor)}
			<button type="button" class="chip ro-chip" aria-pressed={acao === valor} onclick={() => (acao = valor)}>{rotulo}</button>
		{/each}
	</div>
	<strong>Duração</strong>
	<div class="cp-row">
		{#each itensDuracao as [valor, rotulo] (valor)}
			<button type="button" class="chip ro-chip" aria-pressed={duracaoAtiva(valor)} onclick={() => (exp = valor === 'keep' ? undefined : valor)}>{rotulo}</button>
		{/each}
	</div>
</div>

{#if erro}<p id="filter-error" class="error ro-faixa ro-faixa--erro" role="alert">{erro}</p>{/if}
<div class="save-bar">
	<button type="button" class="ro-botao ro-botao--principal edit-save" disabled={salvando} onclick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
</div>
