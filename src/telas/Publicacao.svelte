<script>
	import NoDom from './NoDom.svelte';
	import Ico from './Ico.svelte';

	// Uma publicação (antigo statusEl). `s` é a que veio da lista; a versão exibida é sempre a canônica (`c.canon`),
	// então curtir/impulsionar/editar em qualquer tela atualiza esta aqui sozinho.
	// `c` traz do app o que ainda vive em JS (nós de DOM prontos, ações e abertura de telas).
	let { s, readonly = false, host = null, focal = false, c } = $props();

	const atual = $derived(host ? s : c.canon(s));
	const sh = $derived(atual.reblog || atual);
	const id = $derived(sh.id);
	const conta = $derived(sh.account);

	// Valores simples para os trechos caros só recalcularem quando o conteúdo mudar de fato
	const conteudo = $derived(sh.content);
	const emojis = $derived(sh.emojis);
	const aviso = $derived(sh.spoiler_text);
	const sigMidia = $derived(JSON.stringify([(sh.media_attachments || []).map((m) => [m.url, m.preview_url, m.type, m.description]), sh.sensitive]));
	const sigPoll = $derived(sh.poll ? JSON.stringify(sh.poll) : '');
	const sigCartao = $derived(sh.card ? JSON.stringify(sh.card) : '');
	const sigCitacao = $derived(sh.quote ? JSON.stringify(sh.quote) : '');

	let revelado = $state(c.revealed.has(sh.id));
	const filtros = $derived(revelado ? [] : c.filterHits(atual));
	const nomesFiltro = $derived([...new Set(filtros.map((f) => f.title))].join(', '));

	const traducao = $derived(c.translations.get(id));
	const corpo = $derived(c.sanitizeHtml(traducao && traducao.shown ? traducao.content : conteudo, emojis));
	const longo = $derived(c.plainText(conteudo).length > 600 || (conteudo.match(/<br|<\/p>/g) || []).length > 10);
	let recolhido = $state(true);
	let traduzindo = $state(false);

	const minhaLingua = (navigator.language || 'pt').slice(0, 2);
	const podeTraduzir = $derived(!readonly && !host && c.limits().translation && sh.language && sh.language !== minhaLingua && conteudo);

	// nós de DOM caros: só refeitos quando o conteúdo muda
	const midia = $derived.by(() => { void sigMidia; return c.mediaEl(sh); });
	const enquete = $derived.by(() => { void sigPoll; return sh.poll ? c.pollEl(sh, { readonly: readonly || !!host }) : null; });
	const cartao = $derived.by(() => { void sigCartao; return !sh.poll && !midia && sh.card && !sh.quote ? c.cardEl(sh.card) : null; });
	const citacao = $derived.by(() => { void sigCitacao; return sh.quote && !readonly ? c.quoteEl(sh.quote, host) : null; });
	const nomeConta = $derived(c.nameNode(conta));
	const avisoNo = $derived(aviso ? c.emojiFragment(aviso, emojis) : null);

	const podeImpulsionar = $derived(sh.visibility === 'public' || sh.visibility === 'unlisted');
	const respostaA = $derived(sh.in_reply_to_id && !host ? (sh.mentions || []).find((m) => m.id === sh.in_reply_to_account_id) : null);

	const quando = $derived(c.timeAgo(sh.created_at));
	const quandoCompleto = $derived(new Date(sh.created_at).toLocaleString('pt-BR'));
	const dataFocal = $derived(new Date(sh.created_at).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }));

	// o app lê estas propriedades do elemento (toque para abrir a conversa, menções, atalhos de teclado)
	function marcar(no, p) {
		no._status = p.sh; no._host = p.host;
		return { update(n) { no._status = n.sh; no._host = n.host; } };
	}

	function pulso(ev) {
		const b = ev.currentTarget;
		b.classList.add('pulse');
		setTimeout(() => b.classList.remove('pulse'), 600);
	}
	async function curtir(ev) { const b = ev.currentTarget; pulso(ev); await c.toggle(b, sh, 'fav'); }
	function impulsionar(ev) { if (sh.reblogged) { pulso(ev); c.toggle(ev.currentTarget, sh, 'boost'); } else c.boostSheet(ev.currentTarget, sh); }
	async function salvar(ev) { pulso(ev); await c.toggleBookmark(ev.currentTarget, sh); }
	async function traduzir() {
		traduzindo = true;
		try { await c.translateStatus(sh); } catch (e) { c.toast(e.message); } finally { traduzindo = false; }
	}
	function alternarTraducao() { c.translations.set(id, { ...traducao, shown: !traducao.shown }); }
	function alternarTexto(ev) { recolhido = !recolhido; ev.currentTarget.blur?.(); }
	function mostrar() { c.revealed.add(id); revelado = true; }
</script>

{#if filtros.length}
	<article class="status filtered" data-id={id} use:marcar={{ sh, host }}>
		<span class="muted">Filtrado: {nomesFiltro}</span>
		<button type="button" class="link" onclick={mostrar}>Mostrar</button>
	</article>
{:else}
	<article class="status" class:focal data-id={id} use:marcar={{ sh, host }}>
		{#if atual.reblog}
			<div class="boost-note"><Ico nome="boost" tamanho={14} />
				<span class="link-name" role="button" tabindex="0" onclick={() => c.openAccountFrom(atual.account, host)} onkeydown={(e) => e.key === 'Enter' && c.openAccountFrom(atual.account, host)}><NoDom no={c.nameNode(atual.account)} /></span> impulsionou</div>
		{/if}
		{#if sh.in_reply_to_id && !host}
			<div class="reply-note muted small" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); c.abrirRespondida(sh); }} onkeydown={(e) => e.key === 'Enter' && c.abrirRespondida(sh)}>
				<Ico nome="reply" tamanho={14} /> Em resposta a {respostaA ? '@' + respostaA.acct : 'uma publicação'}</div>
		{/if}
		<header>
			<div class="who-link" role="button" tabindex="0" aria-label="Abrir perfil de {conta.acct}" onclick={() => c.openAccountFrom(conta, host)} onkeydown={(e) => e.key === 'Enter' && c.openAccountFrom(conta, host)}>
				<img class="ro-avatar avatar" src={c.safeUrl(conta.avatar_static || conta.avatar)} alt="" loading="lazy" />
				<div class="who">
					<div class="name"><NoDom no={nomeConta} /></div>
					<span class="acct">@{conta.acct}</span>
				</div>
			</div>
			<div class="when">
				<time datetime={sh.created_at} title={quandoCompleto}>{quando}</time>
				{#if sh.edited_at && !host}<button type="button" class="edited" onclick={() => c.openHistory(sh)}>editado</button>{/if}
			</div>
		</header>

		{#snippet conteudoPub()}
			<div class="body" class:clamp={longo && recolhido}><NoDom no={corpo} /></div>
			{#if longo}<button type="button" class="link more-text" onclick={alternarTexto}>{recolhido ? 'Mostrar mais' : 'Mostrar menos'}</button>{/if}
			{#if podeTraduzir}
				{#if traducao}
					<div class="tr-note muted small">Traduzido de {traducao.lang ? traducao.lang.toUpperCase() : sh.language.toUpperCase()}{traducao.provider ? ` por ${traducao.provider}` : ''} · <button type="button" class="link" onclick={alternarTraducao}>{traducao.shown ? 'Ver original' : 'Ver tradução'}</button></div>
				{:else}
					<button type="button" class="link tr-btn" disabled={traduzindo} onclick={traduzir}>{traduzindo ? 'Traduzindo…' : `Traduzir do ${sh.language.toUpperCase()}`}</button>
				{/if}
			{/if}
			{#if midia}<NoDom no={midia} />{/if}
			{#if enquete}<NoDom no={enquete} />{/if}
			{#if cartao}<NoDom no={cartao} />{/if}
			{#if citacao}<NoDom no={citacao} />{/if}
		{/snippet}

		{#if aviso}
			<details class="cw" open={c.prefs().openCw || undefined}>
				<summary><NoDom no={avisoNo} /></summary>
				{@render conteudoPub()}
			</details>
		{:else}
			{@render conteudoPub()}
		{/if}

		{#if focal}<p class="muted small focal-date">{dataFocal}</p>{/if}
		<div class="actions">
			{#if readonly}
				<a class="open" href={c.safeUrl(sh.url || sh.uri)} target="_blank" rel="noopener noreferrer" aria-label="Abrir original"><Ico nome="external" tamanho={18} /></a>
			{:else}
				<button type="button" class="reply" aria-label={sh.replies_count ? `Responder, ${sh.replies_count}` : 'Responder'} onclick={() => c.openComposer({ replyTo: sh })}><Ico nome="reply" tamanho={20} /><span class="count">{sh.replies_count || ''}</span></button>
				<button type="button" class="boost" class:on={sh.reblogged} aria-pressed={!!sh.reblogged} disabled={!podeImpulsionar} aria-label={sh.reblogs_count ? `Impulsionar, ${sh.reblogs_count}` : 'Impulsionar'} onclick={impulsionar}><Ico nome="boost" tamanho={20} /><span class="count">{sh.reblogs_count || ''}</span></button>
				<button type="button" class="fav" class:on={sh.favourited} aria-pressed={!!sh.favourited} aria-label={sh.favourites_count ? `Favoritar, ${sh.favourites_count}` : 'Favoritar'} onclick={curtir}><Ico nome="fav" tamanho={20} /><span class="count">{sh.favourites_count || ''}</span></button>
				<button type="button" class="bookmark" class:on={sh.bookmarked} aria-pressed={!!sh.bookmarked} aria-label="Salvar" onclick={salvar}><Ico nome="bookmark" tamanho={20} /><span class="count"></span></button>
				<button type="button" class="more-btn" aria-label="Mais opções" onclick={() => c.statusMenu(sh)}><Ico nome="more" tamanho={20} /></button>
			{/if}
		</div>
	</article>
{/if}
