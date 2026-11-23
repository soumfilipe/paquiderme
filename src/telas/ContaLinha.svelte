<script>
	import NomeConta from './NomeConta.svelte';

	/** Linha de uma conta (avatar, nome, @) que abre o perfil, sem botão. `c`: safeUrl, nameNode, openProfile. */
	let { a, c } = $props();
	const abrir = () => c.openProfile(a);
</script>

<div class="ro-linha account-row" role="button" tabindex="0" onclick={abrir} onkeydown={(e) => e.key === 'Enter' && abrir()}>
	<span class="ro-linha__inicio"><img class="ro-avatar avatar" src={c.safeUrl(a.avatar_static || a.avatar)} alt="" loading="lazy" /></span>
	<span class="ro-linha__corpo who">
		<span class="ro-linha__titulo name"><NomeConta conta={a} /></span>
		<span class="ro-linha__sub acct">@{a.acct}</span>
	</span>
</div>
