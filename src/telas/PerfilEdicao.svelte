<script>
	import { Icone } from 'rochedo/svelte';

	// Editar o próprio perfil. `e`: { form, headerUrl, avatarUrl, ... } (o app guarda os blobs das imagens em e.avatarBlob/e.headerBlob).
	// preparar(arquivo, largura, altura) devolve o blob reduzido; aoSalvar() grava e lança Error(mensagem) se falhar;
	// aoMudar() marca o formulário como alterado (para perguntar antes de descartar).
	let { e, preparar, aoSalvar, aoMudar, aviso } = $props();
	const f = e.form;

	let nome = $state(f.display_name);
	let nota = $state(f.note);
	let campos = $state(f.fields.map((x) => ({ ...x })));
	let fechado = $state(f.locked);
	let robo = $state(f.bot);
	let diretorio = $state(f.discoverable);
	let capa = $state(e.headerUrl);
	let foto = $state(e.avatarUrl);
	let erro = $state(e.error || '');
	let salvando = $state(false);
	let entradaCapa;
	let entradaFoto;

	$effect(() => {
		f.display_name = nome;
		f.note = nota;
		f.fields = campos.map((x) => ({ name: x.name, value: x.value }));
		f.locked = fechado;
		f.bot = robo;
		f.discoverable = diretorio;
	});

	const temCapa = $derived(capa && !/missing\.png/.test(capa));

	async function trocar(ev, tipo, w, h) {
		const arquivo = ev.currentTarget.files?.[0];
		if (!arquivo) return;
		const entrada = ev.currentTarget;
		try {
			const blob = await preparar(arquivo, w, h);
			e[tipo + 'Blob'] = blob;
			const url = URL.createObjectURL(blob);
			if (tipo === 'header') capa = url;
			else foto = url;
			aoMudar();
		} catch (err) {
			aviso(err.message);
		}
		entrada.value = '';
	}

	async function salvar() {
		salvando = true;
		erro = '';
		try {
			await aoSalvar();
		} catch (ex) {
			erro = ex.message;
			salvando = false;
		}
	}
	const interruptores = [
		['Perfil fechado (aprovar quem pode me seguir)', () => fechado, () => (fechado = !fechado)],
		['Conta automatizada (robô)', () => robo, () => (robo = !robo)],
		['Aparecer no diretório e nas sugestões', () => diretorio, () => (diretorio = !diretorio)]
	];
</script>

<div class="banner edit-banner" style={temCapa ? `background-image:url("${capa}")` : undefined}>
	<span class="edit-overlay header">
		<input type="file" accept="image/*" hidden aria-label="Trocar capa" bind:this={entradaCapa} onchange={(ev) => trocar(ev, 'header', 1500, 500)} />
		<button class="ro-botao" type="button" aria-label="Trocar capa" onclick={() => entradaCapa.click()}><Icone nome="compose" tamanho={22} /></button>
	</span>
</div>
<div class="edit-media">
	<div class="edit-avatar">
		<img class="profile-avatar" src={foto} alt="Foto atual" />
		<span class="edit-overlay avatar">
			<input type="file" accept="image/*" hidden aria-label="Trocar foto" bind:this={entradaFoto} onchange={(ev) => trocar(ev, 'avatar', 400, 400)} />
			<button class="ro-botao" type="button" aria-label="Trocar foto" onclick={() => entradaFoto.click()}><Icone nome="compose" tamanho={22} /></button>
		</span>
	</div>
	<p class="muted small">Toque no lápis para trocar. As imagens são reduzidas e recortadas ao centro (foto quadrada, capa 3:1).</p>
</div>

<div class="edit-form">
	<label class="edit-field"><span class="muted small">Nome</span>
		<input bind:value={nome} maxlength="30" autocomplete="off" oninput={aoMudar} />
	</label>
	<label class="edit-field"><span class="muted small">Bio</span>
		<textarea bind:value={nota} rows="6" maxlength="500" oninput={aoMudar}></textarea>
	</label>
	<strong>Campos do perfil</strong>
	{#each campos as x, i (i)}
		<div class="edit-pair">
			<input bind:value={x.name} placeholder="Rótulo (ex.: Site)" maxlength="255" aria-label="Campo {i + 1}: rótulo" oninput={aoMudar} />
			<input bind:value={x.value} placeholder="Conteúdo (ex.: https://…)" maxlength="255" autocapitalize="none" aria-label="Campo {i + 1}: conteúdo" oninput={aoMudar} />
		</div>
	{/each}
</div>
{#each interruptores as [rotulo, valor, alternar] (rotulo)}
	<button type="button" class="pick-row" class:on={valor()} role="switch" aria-checked={valor()} onclick={() => { alternar(); aoMudar(); }}>
		<span class="pick-box">{#if valor()}<Icone nome="check" tamanho={16} />{/if}</span>{rotulo}
	</button>
{/each}

{#if erro}<p id="edit-error" class="error ro-faixa ro-faixa--erro" role="alert">{erro}</p>{/if}
<div class="save-bar">
	<button type="button" class="ro-botao ro-botao--principal edit-save" disabled={salvando} onclick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
</div>
