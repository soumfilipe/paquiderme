<script>
	import { BotaoConfirmar, Icone } from 'rochedo/svelte';
	import Estado from './Estado.svelte';
	import LinhaAcao from './LinhaAcao.svelte';

	// Lista de filtros da conta. `e`: { items, loaded, error, reload }.
	// aoNovo()/aoEditar(f)/aoExcluir(f) ficam por conta do app (chamadas à API e navegação).
	let { e, contexto, aoNovo, aoEditar, aoExcluir } = $props();

	const meta = (f) =>
		[
			(f.context || []).map(contexto).join(', ') || 'sem contexto',
			f.filter_action === 'hide' ? 'oculta' : 'recolhe',
			f.expires_at ? `até ${new Date(f.expires_at).toLocaleDateString('pt-BR')}` : null
		]
			.filter(Boolean)
			.join(' · ');
</script>

<p class="muted small nota">
	Filtros ficam na sua conta da instância e valem em qualquer app. Publicações que casarem aparecem recolhidas, com um botão para mostrar.
</p>
<button type="button" class="ro-botao ro-botao--principal novo" onclick={aoNovo}><Icone nome="add" tamanho={18} />Novo filtro</button>

{#if e.error || !e.loaded}
	<Estado erro={e.error} carregando={!e.loaded} aoTentar={e.reload} />
{:else if !e.items.length}
	<Estado vazio="Nenhum filtro ainda." />
{:else}
	{#each e.items as f (f.id)}
		<LinhaAcao>
			<strong>{f.title}</strong>
			<span class="muted small">{(f.keywords || []).map((k) => k.keyword).join(', ') || 'sem palavras'}</span>
			<span class="muted small">{meta(f)}</span>
			{#snippet acoes()}
				<button type="button" class="ro-botao" onclick={() => aoEditar(f)}>Editar</button>
				<BotaoConfirmar rotulo="Confirmar" aoConfirmar={() => aoExcluir(f)}>Excluir</BotaoConfirmar>
			{/snippet}
		</LinhaAcao>
	{/each}
{/if}

<style>
	.nota {
		padding: 0 16px;
	}
	.novo {
		margin: 8px 16px;
	}
</style>
