<script>
	import NomeConta from './NomeConta.svelte';

	/** Linha de uma conta (avatar, nome, @) com um botão à direita. `c` traz url() e abrir(conta). */
	let { conta, rotulo, aoClicar, c, classe = '' } = $props();
	const abrir = () => c.abrir(conta);
</script>

<div class="ro-linha account-row" role="button" tabindex="0" onclick={abrir} onkeydown={(e) => e.key === 'Enter' && abrir()}>
	<span class="ro-linha__inicio"><img class="ro-avatar avatar" src={c.url(conta.avatar_static || conta.avatar)} alt="" loading="lazy" /></span>
	<span class="ro-linha__corpo who">
		<span class="ro-linha__titulo name"><NomeConta conta={conta} /></span>
		<span class="ro-linha__sub acct">@{conta.acct}</span>
	</span>
	<span class="ro-linha__fim">
		<button
			type="button"
			class="ro-botao row-btn {classe}"
			onclick={(ev) => {
				ev.stopPropagation();
				aoClicar(ev.currentTarget);
			}}>{rotulo}</button
		>
	</span>
</div>
