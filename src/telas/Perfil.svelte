<script>
	import { Icone } from 'rochedo/svelte';
	import NoDom from './NoDom.svelte';
	import NomeConta from './NomeConta.svelte';
	import Emoji from './Emoji.svelte';

	// Cabeçalho de um perfil: banner, avatar, ações, selos, bio, campos e contagens.
	// `c` traz o que continua no app.js: p (entrada do perfil), self, seguirNo (botão de seguir, feito em JS),
	// url(), nomeNo(conta), html(texto, emojis), emoji(texto, emojis), contar(n), arroba(conta),
	// editar(), listas(), menu(), abrirPerfil(conta), abrirTag(nome), abrirGente(tipo).
	let { c } = $props();
	const p = $derived(c.p);
	const a = $derived(p.account);
	const cabecalho = $derived(c.url(a.header_static || a.header));
	const temBanner = $derived(cabecalho && !/missing\.png/.test(cabecalho));
	const selos = $derived(
		[
			a.bot && ['Robô', 'bot'],
			a.group && ['Grupo'],
			a.locked && ['Perfil fechado', 'lock'],
			p.rel?.followed_by && ['Segue você'],
			p.rel?.muting && ['Silenciado'],
			p.rel?.blocked_by && ['Bloqueou você']
		].filter(Boolean)
	);
	const campos = $derived((a.fields || []).filter((f) => f.name || f.value));
</script>

{#if temBanner}<img class="banner" src={cabecalho} alt="" />{:else}<div class="banner"></div>{/if}

<section class="profile-head">
	<div class="profile-top">
		<img class="profile-avatar" src={c.url(a.avatar_static || a.avatar)} alt="" />
		{#if c.self}
			<button type="button" class="ro-botao" onclick={c.editar}>Editar</button>
		{:else}
			<div class="profile-actions">
				{#if p.rel?.following}<button type="button" class="ro-botao" onclick={c.listas}>Listas</button>{/if}
				<NoDom no={c.seguirNo()} />
				<button type="button" class="ro-botao ro-botao--quieto ro-botao--icone icon-btn" aria-label="Mais opções da conta" onclick={c.menu}><Icone nome="more" tamanho={22} /></button>
			</div>
		{/if}
	</div>
	<h2 class="profile-name"><NomeConta conta={a} /></h2>
	<div class="handle">@{c.arroba(a)}</div>
	{#if selos.length}
		<div class="badges">
			{#each selos as [rotulo, icone] (rotulo)}
				<span class="badge">{#if icone}<Icone nome={icone} tamanho={13} />{/if}{rotulo}</span>
			{/each}
		</div>
	{/if}
	{#if a.moved}
		<p class="muted small">Mudou para <span class="link-name" role="button" tabindex="0" onclick={() => c.abrirPerfil(a.moved)} onkeydown={(e) => e.key === 'Enter' && c.abrirPerfil(a.moved)}>@{a.moved.acct}</span></p>
	{/if}
	{#if a.note}<div class="bio"><NoDom no={c.html(a.note, a.emojis)} /></div>{/if}
	{#if p.featured?.length}
		<div class="featured-tags">
			{#each p.featured as t (t.name)}
				<button type="button" class="chip ro-chip" onclick={() => c.abrirTag(t.name)}>#{t.name}{#if t.statuses_count}<span class="muted small"> {t.statuses_count}</span>{/if}</button>
			{/each}
		</div>
	{/if}
	{#if campos.length}
		<dl class="fields">
			{#each campos as f, i (i)}
				<div class="field">
					<dt><Emoji texto={f.name || ''} emojis={a.emojis} /></dt>
					<dd class:verified={f.verified_at}><NoDom no={c.html(f.value, a.emojis)} />{#if f.verified_at}<Icone nome="check" tamanho={16} />{/if}</dd>
				</div>
			{/each}
		</dl>
	{/if}
	<div class="counts">
		<span><strong>{c.contar(a.statuses_count)}</strong> publicações</span>
		<button type="button" class="count-btn" onclick={() => c.abrirGente('following')}><strong>{c.contar(a.following_count)}</strong> seguindo</button>
		<button type="button" class="count-btn" onclick={() => c.abrirGente('followers')}><strong>{c.contar(a.followers_count)}</strong> seguidores</button>
	</div>
	<p class="muted small">
		{a.created_at ? `Entrou em ${new Date(a.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · ` : ''}<a href={c.url(a.url)} target="_blank" rel="noopener noreferrer">abrir no navegador</a>
	</p>
	{#if p.error}<p class="error">{p.error}</p>{/if}
</section>
