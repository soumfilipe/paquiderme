<script>
	import { safeUrl } from '../../lib.js';
	import NomeConta from './NomeConta.svelte';
	import Ico from './Ico.svelte';

	// Contas salvas no app (folha "Contas"). `ativa`: sessão atual; `trocar(sessao)` entra nela; `fechar()` fecha a folha.
	let { sessoes, ativa, trocar, fechar } = $props();
	const igual = (x, y) => !!x && !!y && x.host === y.host && x.account.id === y.account.id;
</script>

<div class="acc-list">
	{#each sessoes as s (s.host + s.account.id)}
		{@const atual = igual(s, ativa)}
		<button type="button" class="ro-linha acc-row" class:active={atual} aria-current={atual ? 'true' : null} onclick={() => (atual ? fechar() : trocar(s))}>
			<span class="ro-linha__inicio"><img class="ro-avatar avatar" src={safeUrl(s.account.avatar)} alt="" /></span>
			<span class="ro-linha__corpo">
				<span class="ro-linha__titulo"><NomeConta conta={s.account} /></span>
				<span class="ro-linha__sub">@{s.account.acct}@{s.host}</span>
			</span>
			{#if atual}<span class="ro-linha__fim"><Ico nome="check" tamanho={18} /></span>{/if}
		</button>
	{/each}
</div>
