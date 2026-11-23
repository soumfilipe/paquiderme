<script>
	import Publicacao from './Publicacao.svelte';
	import RodapeLista from './RodapeLista.svelte';
	import NomeConta from './NomeConta.svelte';

	// Avisos (notificações agrupadas), menções e mensagens diretas. `st` é a lista reativa do tipo mostrado;
	// `c` traz do app o que ainda vive em JS (publicação, nomes com emojis, abrir perfil e conversa).
	let { tipo, st, c, aoMais, aoTentar } = $props();

	const VERBOS = {
		reblog: ['impulsionou', 'impulsionaram', 'sua publicação'],
		favourite: ['favoritou', 'favoritaram', 'sua publicação'],
		follow: ['seguiu', 'seguiram', 'você']
	};
	const TIPOS = {
		mention: 'mencionou você', status: 'publicou', reblog: 'impulsionou sua publicação', favourite: 'favoritou sua publicação',
		follow: 'seguiu você', follow_request: 'quer seguir você', poll: 'enquete encerrada', update: 'editou uma publicação',
		quote: 'citou sua publicação', quoted_update: 'editou uma publicação que você citou', 'admin.sign_up': 'novo cadastro na instância',
		'admin.report': 'nova denúncia', severed_relationships: 'relações cortadas', moderation_warning: 'aviso de moderação'
	};

	const unicas = (ns) => { const vistos = new Set(); return ns.map((n) => n.account).filter((x) => !vistos.has(x.id) && vistos.add(x.id)); };

	// Junta favoritos/impulsos da mesma publicação (e seguidores em sequência) numa só linha
	function agrupar(items) {
		const out = []; const porStatus = new Map();
		for (const n of items) {
			if ((n.type === 'reblog' || n.type === 'favourite') && n.status) {
				let g = porStatus.get(n.status.id);
				if (!g) { g = { grupo: true, status: n.status, por: {}, recente: n.created_at, id: 'g' + n.status.id }; porStatus.set(n.status.id, g); out.push(g); }
				(g.por[n.type] = g.por[n.type] || []).push(n);
			} else if (n.type === 'follow' && out.length && out[out.length - 1].seguidores) {
				out[out.length - 1].seguidores.push(n);
			} else if (n.type === 'follow') {
				out.push({ seguidores: [n], id: 'f' + n.id });
			} else out.push(n);
		}
		return out;
	}

	const itens = $derived(tipo === 'notifications' ? agrupar(st.items) : st.items);

	const nomes = (contas) => {
		const mostrados = contas.slice(0, 2);
		return { mostrados, resto: contas.length - mostrados.length };
	};

	// pedidos de seguir: resolvidos aqui mesmo, sem recarregar a lista
	let pedidos = $state({});
	async function responder(n, verbo, texto) {
		pedidos[n.id] = { ocupado: true };
		try {
			await c.api(`/api/v1/follow_requests/${n.account.id}/${verbo}`, { method: 'POST' });
			pedidos[n.id] = { feito: texto };
		} catch (e) { c.toast(e.message); pedidos[n.id] = {}; }
	}

	function abrirConversa(cv) {
		if (cv.unread) { cv.unread = false; c.api(`/api/v1/conversations/${cv.id}/read`, { method: 'POST' }).catch(() => {}); }
		c.openThread(cv.last_status);
	}
	const chave = (it) => it.id;
</script>

{#snippet linhaNomes(contas)}
	{@const n = nomes(contas)}
	<strong class="link-name" role="button" tabindex="0" onclick={() => c.openProfile(n.mostrados[0])} onkeydown={(e) => e.key === 'Enter' && c.openProfile(n.mostrados[0])}><NomeConta conta={n.mostrados[0]} /></strong>{#if n.mostrados[1]}{n.resto > 0 ? ', ' : ' e '}<strong class="link-name" role="button" tabindex="0" onclick={() => c.openProfile(n.mostrados[1])} onkeydown={(e) => e.key === 'Enter' && c.openProfile(n.mostrados[1])}><NomeConta conta={n.mostrados[1]} /></strong>{/if}{n.resto > 0 ? ` e mais ${n.resto}` : ''}
{/snippet}

{#snippet pilha(contas)}
	<div class="notif-avatars">
		{#each contas.slice(0, 6) as a (a.id)}
			<img class="ro-avatar avatar" src={c.safeUrl(a.avatar_static || a.avatar)} alt={a.display_name || a.acct} loading="lazy" onclick={() => c.openProfile(a)} />
		{/each}
		{#if contas.length > 6}<span class="more-count">+{contas.length - 6}</span>{/if}
	</div>
{/snippet}

{#snippet linhaTipo(tp, ns, quando)}
	{@const contas = unicas(ns)}
	<div class="notif-kind">{@render linhaNomes(contas)} {contas.length > 1 ? VERBOS[tp][1] : VERBOS[tp][0]} {VERBOS[tp][2]}{quando ? ` · ${c.timeAgo(quando)}` : ''}</div>
{/snippet}

{#snippet contaSimples(a)}
	<div class="ro-linha account-row" role="button" tabindex="0" onclick={() => c.openProfile(a)} onkeydown={(e) => e.key === 'Enter' && c.openProfile(a)}>
		<span class="ro-linha__inicio"><img class="ro-avatar avatar" src={c.safeUrl(a.avatar_static || a.avatar)} alt="" loading="lazy" /></span>
		<span class="ro-linha__corpo who">
			<span class="ro-linha__titulo name"><NomeConta conta={a} /></span>
			<span class="ro-linha__sub acct">@{a.acct}</span>
		</span>
	</div>
{/snippet}

{#snippet aviso(n)}
	<div class="notif">
		<div class="notif-kind">
			<strong class="link-name" role="button" tabindex="0" onclick={() => c.openProfile(n.account)} onkeydown={(e) => e.key === 'Enter' && c.openProfile(n.account)}><NomeConta conta={n.account} /></strong>
			{TIPOS[n.type] || n.type} · {c.timeAgo(n.created_at)}
		</div>
		{#if n.status}<Publicacao s={n.status} {c} />{:else}{@render contaSimples(n.account)}{/if}
		{#if n.type === 'follow_request'}
			{@const p = pedidos[n.id] || {}}
			<div class="req-actions">
				{#if p.feito}<span class="muted">{p.feito}</span>{:else}
					<button type="button" class="ro-botao ro-botao--principal" disabled={p.ocupado} onclick={() => responder(n, 'authorize', 'Pedido aceito')}>Aceitar</button>
					<button type="button" class="ro-botao" disabled={p.ocupado} onclick={() => responder(n, 'reject', 'Pedido rejeitado')}>Rejeitar</button>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#each itens as it (chave(it))}
	{#if tipo === 'convs'}
		{#if it.last_status}
			{@const contas = it.accounts && it.accounts.length ? it.accounts : [it.last_status.account]}
			<div class="conv" class:unread={it.unread} role="button" tabindex="0" onclick={() => abrirConversa(it)} onkeydown={(e) => e.key === 'Enter' && abrirConversa(it)}>
				{@render pilha(contas)}
				<div class="conv-body">
					<div class="conv-top"><strong>{contas.map((x) => x.display_name || x.acct).join(', ')}</strong><time class="muted small">{c.timeAgo(it.last_status.created_at)}</time></div>
					<div class="conv-text muted">{c.plainText(it.last_status.content) || (it.last_status.media_attachments && it.last_status.media_attachments.length ? '(mídia)' : '')}</div>
				</div>
				{#if it.unread}<span class="conv-dot" aria-label="Não lida"></span>{/if}
			</div>
		{/if}
	{:else if it.grupo}
		<div class="notif group">
			{@render pilha(unicas(Object.values(it.por).flat()))}
			{#each ['reblog', 'favourite'].filter((t) => it.por[t]) as t, k (t)}
				{@render linhaTipo(t, it.por[t], k === 0 ? it.recente : null)}
			{/each}
			<Publicacao s={it.status} {c} />
		</div>
	{:else if it.seguidores}
		{#if unicas(it.seguidores).length === 1}
			{@render aviso(it.seguidores[0])}
		{:else}
			<div class="notif group">{@render pilha(unicas(it.seguidores))}{@render linhaTipo('follow', it.seguidores, it.seguidores[0].created_at)}</div>
		{/if}
	{:else}
		{@render aviso(it)}
	{/if}
{/each}

<RodapeLista {st} {aoMais} {aoTentar} />
