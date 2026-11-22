<script>
	/** Formulário de nova lista. aoCriar(titulo) devolve uma promessa. */
	let { aoCriar } = $props();
	let titulo = $state('');
</script>

<form
	class="inst-form"
	onsubmit={async (ev) => {
		ev.preventDefault();
		const t = titulo;
		titulo = '';
		await aoCriar(t);
	}}
>
	<input bind:value={titulo} placeholder="Nome da nova lista" maxlength="100" aria-label="Nome da nova lista" />
	<button type="submit" class="ro-botao ro-botao--principal">Criar</button>
</form>
