<script>
	// Status da instância: resultado das verificações de saúde (sessão, linha do tempo, tempo real).
	// `e` é a entrada do app: { checks, at, reload }; `host` é a instância da sessão.
	let { e, host } = $props();

	const pior = $derived(
		!e.checks ? null : e.checks.some((c) => c.state === 'bad') ? 'bad' : e.checks.some((c) => c.state === 'warn') ? 'warn' : 'ok'
	);
	const titulo = { ok: 'Tudo funcionando', warn: 'Funcionando com lentidão ou ressalvas', bad: 'Há problemas' };
</script>

{#if !e.checks}
	<div class="ro-carregando" aria-busy="true" aria-label="Verificando…"><i></i><i></i><i></i></div>
{:else}
	<div class="cabeca {pior}"><span class="ponto {pior}"></span><strong>{titulo[pior]}</strong></div>
	{#each e.checks as c (c.name)}
		<div class="linha">
			<span class="ponto {c.state}"></span>
			<div>
				<strong>{c.name}</strong>
				<div>{c.text}</div>
				{#if c.detail}<div class="muted small">{c.detail}</div>{/if}
			</div>
		</div>
	{/each}
	<div class="rodape">
		<span class="muted small">Verificado às {e.at.toLocaleTimeString('pt-BR', { timeStyle: 'short' })}</span>
		<button type="button" class="ro-botao" onclick={() => e.reload()}>Verificar de novo</button>
		<a class="link" href="https://{host}/about" target="_blank" rel="noopener noreferrer">Sobre a instância</a>
	</div>
{/if}

<style>
	.cabeca {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 12px 16px;
		padding: 14px;
		border-radius: var(--radius-card);
		background: var(--surface-2);
	}
	.linha {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
	}
	.ponto {
		flex: none;
		width: 12px;
		height: 12px;
		margin-top: 4px;
		border-radius: 50%;
		background: var(--muted);
	}
	.ponto.ok {
		background: #3ecf8e;
	}
	.ponto.warn {
		background: #f5b83d;
	}
	.ponto.bad {
		background: var(--danger);
	}
	.rodape {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
	}
</style>
