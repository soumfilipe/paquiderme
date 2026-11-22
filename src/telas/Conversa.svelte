<script>
	import Publicacao from './Publicacao.svelte';
	import Estado from './Estado.svelte';

	// Conversa: antepassados, publicação em foco e respostas em árvore. `t`: entrada reativa da pilha de telas
	// ({ status, ancestors, descendants, host, loading, error, loaded }).
	let { t, c, aoTentar } = $props();
	const opts = $derived({ readonly: !!t.host, host: t.host });

	// A API não garante a ordem em árvore: monta pelas respostas (in_reply_to_id) e percorre em profundidade.
	const respostas = $derived.by(() => {
		const filhos = new Map();
		const ids = new Set(t.descendants.map((s) => s.id));
		ids.add(t.status.id);
		for (const s of t.descendants) {
			const pai = ids.has(s.in_reply_to_id) ? s.in_reply_to_id : t.status.id; // órfãs ficam ligadas ao foco
			if (!filhos.has(pai)) filhos.set(pai, []);
			filhos.get(pai).push(s);
		}
		filhos.forEach((l) => l.sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0)));
		const saida = [];
		const andar = (id, d) => (filhos.get(id) || []).forEach((s) => { saida.push({ s, d }); andar(s.id, d + 1); });
		andar(t.status.id, 1);
		return saida;
	});
</script>

{#each t.ancestors as s (s.id)}
	<div class="thread-item ancestor" style="--d:0"><Publicacao {s} {...opts} {c} /></div>
{/each}
<div class="thread-item focal" style="--d:0"><Publicacao s={t.status} {...opts} focal {c} /></div>
{#each respostas as r (r.s.id)}
	<div class="thread-item reply" style="--d:{Math.min(r.d, 5)}"><Publicacao s={r.s} {...opts} {c} /></div>
{/each}

{#if t.loading}
	<Estado carregando rotulo="Carregando conversa…" />
{:else if t.error}
	<Estado erro={t.error} {aoTentar} />
{:else if t.loaded && !t.descendants.length}
	<Estado vazio={t.ancestors.length ? 'Sem respostas ainda.' : 'Ninguém respondeu ainda.'} />
{/if}
