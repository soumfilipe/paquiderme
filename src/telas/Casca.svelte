<script>
	import { estado as st } from '../estado.svelte.js';
	import { gatilho } from '../casca.svelte.js';
	import Cabecalho from './Cabecalho.svelte';
	import Conversa from './Conversa.svelte';
	import Legado from './Legado.svelte';
	import BarraAbas from './BarraAbas.svelte';
	import LinhaDoTempo from './LinhaDoTempo.svelte';
	import Avisos from './Avisos.svelte';
	import Perfil from './Perfil.svelte';
	import ListaContas from './ListaContas.svelte';
	import Configuracoes from './Configuracoes.svelte';
	import EmAlta from './EmAlta.svelte';
	import Resultados from './Resultados.svelte';
	import BuscaTipos from './BuscaTipos.svelte';
	import HashtagsSeguidas from './HashtagsSeguidas.svelte';
	import OutraInstancia from './OutraInstancia.svelte';
	import Publicacao from './Publicacao.svelte';
	import Ico from './Ico.svelte';

	// A casca do app: escolhe a tela pelo estado (aba, pilha de telas, busca, configurações) e reage a ele.
	// `c` traz do app.js o que ainda vive lá (carregamentos, ações, nós de DOM).
	let { c } = $props();

	const topo = $derived(st.profiles.length ? st.profiles[st.profiles.length - 1] : null);
	const perfil = $derived(topo ? (topo.type ? null : topo) : st.tab === 'account' ? st.me : null);
	const raiz = $derived(perfil && perfil === st.me && st.profiles.length === 0);
	const ex = $derived(st.explore);
	// partes do app que não são reativas (alarme, contas salvas, preferências) são relidas quando o gatilho muda
	const alarme = $derived((gatilho.v, c.alarme()));
	const outras = $derived((gatilho.v, c.instanciasSalvas()));

	const lista = (tipo) => (tipo === 'list' ? st.listTl : st[tipo]);
	const tipoAvisos = $derived(st.notifTab === 'mentions' ? 'mentions' : st.notifTab === 'dms' ? 'convs' : 'notifications');
	const segs = (l) => l.map(([id, rotulo]) => ({ id, rotulo }));
</script>

{#snippet linha(tipo, extra = {})}
	{#key tipo}
		<LinhaDoTempo st={lista(tipo)} {...extra} c={c.pub} aoMais={() => c.carregar(tipo, true)} aoTentar={() => c.carregar(tipo, lista(tipo).items.length > 0)} />
	{/key}
{/snippet}

{#if topo && topo.type === 'thread'}
	{#key topo.uid}
		<Cabecalho titulo="Conversa" aoVoltar={c.fecharPerfil} />
		<Conversa t={topo} c={c.lista} aoTentar={() => c.carregarConversa(topo)} />
	{/key}
{:else if topo && topo.type}
	{#key topo.uid}
		<Legado fn={(el) => c.entrada(el, topo)} pular={() => c.pularEntrada(topo)} />
	{/key}
{:else if perfil}
	{#if raiz && st.settingsOpen}
		<Cabecalho titulo="Configurações" aoVoltar={c.fecharConfiguracoes} />
		<Configuracoes c={(gatilho.v, c.configuracoes())} />
	{:else if perfil.people}
		<Cabecalho titulo={perfil.people === 'followers' ? 'Seguidores' : 'Seguindo'} aoVoltar={() => c.fecharGente(perfil)} />
		{#key perfil.people}
			<ListaContas st={perfil[perfil.people]} c={c.lista}
				aoMais={() => c.carregar('p:' + perfil.people, true)} aoTentar={() => c.carregar('p:' + perfil.people, perfil[perfil.people].items.length > 0)} />
		{/key}
	{:else}
		{@const a = perfil.account}
		<Cabecalho titulo={c.nomeNo(a)} aoVoltar={raiz ? null : c.fecharPerfil}
			acoes={raiz ? [{ aria: 'Trocar de conta', icone: 'users', aoClicar: c.contas }, { aria: 'Configurações do app', icone: 'settings', aoClicar: c.abrirConfiguracoes }] : []} />
		<Perfil c={c.perfil(perfil)} />
		<BarraAbas itens={segs(c.segsPerfil(perfil))} valor={perfil.seg} aoMudar={(id) => c.mudarSegPerfil(perfil, id)} sob nome="Perfil" />
		{#if a.locked && a.id !== c.contaId && !(perfil.rel && perfil.rel.following)}
			<p class="note muted small">Perfil fechado: siga a conta para ver as publicações.</p>
		{/if}
		{#if perfil.seg === 'posts'}
			{#each perfil.pinned as s (s.id)}
				<div class="pinned">
					<div class="pinned-note muted small"><Ico nome="pin" tamanho={14} /> Fixada</div>
					<Publicacao {s} c={c.pub} />
				</div>
			{/each}
		{/if}
		{@const fixadas = new Set(perfil.pinned.map((s) => s.id))}
		{#key perfil.uid + ':' + perfil.seg}
			<LinhaDoTempo st={perfil[perfil.seg]} ocultar={(s) => perfil.seg === 'posts' && fixadas.has(s.id)} c={c.pub}
				aoMais={() => c.carregar('p:' + perfil.seg, true)} aoTentar={() => c.carregar('p:' + perfil.seg, perfil[perfil.seg].items.length > 0)} />
		{/key}
	{/if}
{:else if st.tab === 'home'}
	{#if alarme}
		<div class="alarm" role="status"><span>{alarme}</span><button type="button" class="link" onclick={c.verStatus}>Ver status</button></div>
	{/if}
	<BarraAbas itens={[{ id: '', rotulo: 'Início' }, ...st.lists.items.map((l) => ({ id: l.id, rotulo: l.title }))]}
		valor={st.homeList || ''} aoMudar={c.mudarLista} nome="Início e listas"
		acao={{ rotulo: 'Listas', icone: 'settings', aria: 'Gerenciar listas', aoClicar: c.gerenciarListas }} />
	{@render linha(st.homeList ? 'list' : 'home')}
{:else if st.tab === 'notifications'}
	<BarraAbas itens={segs(c.abasAvisos)} valor={st.notifTab} aoMudar={c.mudarAbaAvisos} nome="Avisos" />
	{#key tipoAvisos}
		<Avisos tipo={tipoAvisos} st={st[tipoAvisos]} c={c.lista}
			aoMais={() => c.carregar(tipoAvisos, true)} aoTentar={() => c.carregar(tipoAvisos, st[tipoAvisos].items.length > 0)} />
	{/key}
{:else if st.tab === 'explore'}
	{#if ex.tag}
		<div class="tag-head">
			<button type="button" class="ro-botao ro-botao--quieto ro-botao--icone icon-btn" aria-label="Voltar" onclick={c.fecharTag}><Ico nome="back" tamanho={22} /></button>
			<strong>#{ex.tag}</strong>
			{#if ex.tagFollowing !== null}
				<button type="button" class="chip ro-chip push-right" aria-pressed={ex.tagFollowing ? 'true' : 'false'} onclick={() => c.seguirTag(ex.tag)}>{ex.tagFollowing ? 'Seguindo' : 'Seguir'}</button>
			{/if}
		</div>
		{@render linha('tag')}
	{:else if st.search.active}
		<BuscaTipos tipos={c.tiposBusca} atual={st.search.type} aoEscolher={c.escolherTipoBusca} />
		<Resultados s={st.search} c={c.lista} aoMais={() => c.buscar(true)} aoTentar={() => c.buscar()} />
	{:else}
		<BarraAbas itens={segs(c.segmentos)} valor={ex.seg} aoMudar={c.mudarSegmento} nome="Explorar" />
		{#if ex.seg === 'trends'}
			<EmAlta t={st.trends} c={c.lista} aoTentar={c.carregarEmAlta} aoDispensar={c.dispensarAviso} />
		{:else if ex.seg === 'tags'}
			<HashtagsSeguidas f={st.followedTags} aoTentar={c.carregarHashtags} aoAbrir={c.abrirTag} aoDeixar={c.deixarTag} />
		{:else if ex.seg === 'other'}
			<OutraInstancia host={ex.otherHost} salvas={outras} aoIr={c.irOutra} />
			{#if ex.otherHost}{@render linha('other', { readonly: true, host: ex.otherHost })}{/if}
		{:else}
			{@render linha(ex.seg)}
		{/if}
	{/if}
{/if}
