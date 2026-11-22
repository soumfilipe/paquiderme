<script>
	import { BotaoConfirmar } from 'rochedo/svelte';
	import Estado from './Estado.svelte';
	import LinhaAcao from './LinhaAcao.svelte';

	// Publicações agendadas. `e`: { items, loaded, error, reload }; aoCancelar(item) apaga no servidor.
	let { e, aoCancelar } = $props();
</script>

{#if e.error || !e.loaded}
	<Estado erro={e.error} carregando={!e.loaded} aoTentar={e.reload} />
{:else if !e.items.length}
	<Estado vazio="Nenhuma publicação agendada." />
{:else}
	{#each e.items as it (it.id)}
		<LinhaAcao>
			<strong>{new Date(it.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</strong>
			<span>{it.params?.text || (it.media_attachments?.length ? '(mídia)' : '')}</span>
			{#snippet acoes()}
				<BotaoConfirmar rotulo="Confirmar" aoConfirmar={() => aoCancelar(it)}>Cancelar</BotaoConfirmar>
			{/snippet}
		</LinhaAcao>
	{/each}
{/if}
