<script>
	import { Icone, Interruptor } from 'rochedo/svelte';
	import NomeConta from './NomeConta.svelte';

	// Configurações do app. `c` agrupa os dados e as ações que continuam no app.js:
	// c.sessoes, c.ativa, c.prefs, c.push, c.alertasPush, c.appNome, c.appUrl, c.host,
	// c.definirPref(chave, valor), c.setPushAlert(chave, valor), c.ativarPush(), c.desativarPush(),
	// c.adicionarConta(), c.atualizarApp(), c.sair(), c.trocarConta(sessao), c.copiar(texto), c.abrir(nome)
	let { c } = $props();

	const escolhas = [
		['Tema', 'theme', [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']]],
		['Tamanho do texto', 'textSize', [[100, 'Padrão'], [112, 'Grande'], [125, 'Maior'], [140, 'Máximo']]],
		['Animações', 'motion', [['auto', 'Padrão do sistema'], ['reduce', 'Reduzir']]],
		['Visibilidade ao publicar', 'defaultVis', [['', 'Lembrar a última'], ['public', 'Pública'], ['unlisted', 'Não listada'], ['private', 'Só seguidores']]]
	];
	const interruptores = [
		['Mostrar mídia sensível sem desfocar', 'showSensitive'],
		['Abrir avisos de conteúdo já expandidos', 'openCw'],
		['Receber publicações e avisos em tempo real', 'live']
	];
	const moderacao = [
		['filter', 'Filtros de palavras', 'filtros'],
		['clock', 'Publicações agendadas', 'agendadas'],
		['refresh', 'Status da instância', 'saude'],
		['mute', 'Contas silenciadas', 'silenciadas'],
		['block', 'Contas bloqueadas', 'bloqueadas']
	];
	const ps = $derived(c.push);
	const ios = /iPhone|iPad/.test(navigator.userAgent);
	const base = $derived(`${c.appUrl}?text=`);
</script>

<div class="cartao">
	<strong>Contas</strong>
	<div class="lista-contas">
		{#each c.sessoes as s (s.account.id + s.host)}
			{@const ativa = c.ehAtiva(s)}
			<button type="button" class="ro-linha acc-row" class:active={ativa} aria-current={ativa ? 'true' : undefined} onclick={() => !ativa && c.trocarConta(s)}>
				<span class="ro-linha__inicio"><img class="ro-avatar avatar" src={c.url(s.account.avatar)} alt="" /></span>
				<span class="ro-linha__corpo">
					<span class="ro-linha__titulo"><NomeConta conta={s.account} /></span>
					<span class="ro-linha__sub">@{s.account.acct}@{s.host}</span>
				</span>
				{#if ativa}<span class="ro-linha__fim"><Icone nome="check" tamanho={18} /></span>{/if}
			</button>
		{/each}
	</div>
	<button type="button" class="ro-botao" onclick={c.adicionarConta}><Icone nome="user-add" tamanho={18} />Adicionar conta</button>
	<a class="ro-botao ro-botao--link" href="https://{c.host}/settings/profile" target="_blank" rel="noopener noreferrer">Editar perfil e preferências na instância</a>
	<button type="button" class="ro-botao" onclick={c.atualizarApp}><Icone nome="refresh" tamanho={18} />Atualizar o app (limpar cache)</button>
	<button type="button" class="ro-botao" onclick={c.sair}><Icone nome="logout" tamanho={18} />{c.sessoes.length > 1 ? 'Sair desta conta' : 'Sair'}</button>
	<p class="muted small">{c.appNome} · cliente estático, sem servidor próprio. O token fica só neste aparelho.</p>
</div>

<div class="cartao">
	<strong>Aparência e comportamento</strong>
	{#each escolhas as [rotulo, chave, opcoes] (chave)}
		<div class="grupo" role="group" aria-label={rotulo}>
			<span class="muted small">{rotulo}</span>
			<div class="fila">
				{#each opcoes as [valor, texto] (valor)}
					<button type="button" class="ro-chip" aria-pressed={c.prefs[chave] === valor} onclick={() => c.definirPref(chave, valor)}>{texto}</button>
				{/each}
			</div>
		</div>
	{/each}
	{#each interruptores as [rotulo, chave] (chave)}
		<Interruptor marcado={!!c.prefs[chave]} {rotulo} aoMudar={(v) => c.definirPref(chave, v)} />
	{/each}
</div>

<div class="cartao">
	<strong>Avisos no aparelho</strong>
	{#if !ps.loaded || ps.loading}
		<p class="muted small">Verificando…</p>
	{:else if !ps.supported}
		<p class="muted small">Este navegador não oferece avisos push. No iPhone, adicione o Paquiderme à Tela de Início (iOS 16.4 ou mais novo) e abra por lá.</p>
	{:else if ios && !ps.standalone}
		<p class="muted small">No iPhone os avisos só funcionam no app instalado: toque em Compartilhar › Adicionar à Tela de Início e abra por lá.</p>
	{:else}
		{#if ps.sub}
			{#each c.alertasPush as [chave, rotulo] (chave)}
				<Interruptor marcado={!!ps.sub.alerts?.[chave]} {rotulo} aoMudar={(v) => c.setPushAlert(chave, v)} />
			{/each}
			<button type="button" class="ro-botao" onclick={c.desativarPush}>Desativar avisos</button>
		{:else}
			<p class="muted small">Receba menções e novos seguidores mesmo com o app fechado. A instância envia direto ao seu aparelho; o Paquiderme não tem servidor.</p>
			<button type="button" class="ro-botao ro-botao--principal" onclick={c.ativarPush}>Ativar avisos</button>
		{/if}
		{#if ps.error}<div class="ro-faixa ro-faixa--erro" role="alert"><p class="ro-faixa__texto">{ps.error}</p></div>{/if}
	{/if}
</div>

<div class="cartao">
	<strong>Compartilhar para o Paquiderme</strong>
	<p class="muted small">No Android, instalado o app, ele aparece no menu Compartilhar. No iPhone o sistema ainda não permite isso a apps da tela de início; dá para usar um atalho do app Atalhos:</p>
	<ol class="muted small passos">
		<li>No Atalhos, crie um atalho novo e ative “Mostrar na Folha de Compartilhamento”.</li>
		<li>Adicione a ação “Codificar URL” (entrada: Entrada do Atalho) e depois “Abrir URLs”.</li>
		<li>Na URL, use o endereço abaixo seguido do resultado da codificação.</li>
	</ol>
	<code class="endereco">{base}</code>
	<button type="button" class="ro-botao" onclick={() => c.copiar(base)}><Icone nome="copy" tamanho={18} />Copiar endereço</button>
	<p class="muted small">Atenção: no iPhone “Abrir URLs” abre o Safari, não o app instalado. Nesse caso o login do Safari é separado do app.</p>
</div>

<div class="cartao">
	<strong>Conta e moderação</strong>
	{#each moderacao as [icone, rotulo, destino] (destino)}
		<button type="button" class="ro-botao" onclick={() => c.abrir(destino)}><Icone nome={icone} tamanho={18} />{rotulo}</button>
	{/each}
</div>

<style>
	.cartao {
		padding: 20px 16px;
		display: grid;
		gap: 12px;
		border-radius: var(--radius-card);
	}
	.lista-contas {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.grupo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 10px;
	}
	.fila {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.endereco {
		display: block;
		word-break: break-all;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--surface-2);
		font-size: 13px;
	}
	.passos {
		margin: 0;
		padding-left: 20px;
	}
</style>
