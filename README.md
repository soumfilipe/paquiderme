# Paquiderme

Cliente pessoal e estático para o fediverso (API compatível com Mastodon), pensado para rodar no Safari do iPhone como PWA. Sem servidor próprio: tudo roda no navegador e fala direto com a instância.

## Como funciona
- Vite + Svelte 5. O estado do app é reativo (`src/*.svelte.js`) e as telas são componentes Svelte (`src/telas`), escolhidos pela `Casca.svelte`. O `app.js` guarda a lógica de rede, login, listas, transmissão ao vivo e as ações.
- Login por OAuth com PKCE direto na instância; o token fica só no `localStorage` do aparelho. A URL de retorno é calculada em tempo de execução. Há login manual por código colado, para quando o iOS abrir a autorização fora do app instalado.
- Publicações têm uma versão canônica (`src/publicacoes.svelte.js`): curtir, impulsionar ou editar atualiza todas as telas.
- Design system: [Rochedo](https://github.com/soumfilipe/rochedo) (dependência npm por tag).

## Desenvolvimento
```
npm install
npm run dev      # servidor local em http://localhost:8765/ (localhost conta como contexto seguro)
npm run lint     # ESLint (JS e Svelte)
npm run build    # gera dist/ (inclui o service worker com a lista de arquivos e a versão do cache)
```
O `sw.js` da raiz é só o modelo; o build gera o de `dist/`.

## Publicação
`.github/workflows/pages.yml` constrói e publica `dist/` no GitHub Pages a cada push em `principal` (em *Settings → Pages* a fonte precisa ser **GitHub Actions**). `.github/workflows/verificar.yml` roda lint, build, `npm audit` e os testes e2e em cada pull request. O domínio próprio fica no arquivo `CNAME`. No iPhone: abra no Safari → Compartilhar → *Adicionar à Tela de Início* e faça o login **de dentro do app instalado**.

## Como uma versão nova chega
O service worker novo baixa em segundo plano e espera; o app mostra "nova versão do app · atualizar" (`src/telas/AvisoAtualizacao.svelte`). Ao tocar, o SW novo assume (`SKIP_WAITING`) e a página recarrega. Nada recarrega sozinho, para não perder um rascunho. Plano B: Configurações → *Atualizar o app (limpar cache)*.

## Segurança
- **Token**: guardado no `localStorage` (não há onde escondê-lo num app sem servidor). Sai só para a instância da conta ativa: `api()` recusa chamadas autenticadas para outro host. Ao sair da conta o token é revogado e o cache local da conta é apagado.
- **Conteúdo de terceiros**: o HTML das publicações passa por `htmlSeguro` (`lib.js`): lista de permissão de tags, classes e endereços (`http`/`https`), texto com escape. Só a saída dele entra por `{@html}` (`Corpo.svelte`). Qualquer outro `{@html}` ou `innerHTML` com dados externos é erro.
- **CSP** (meta em `index.html`): scripts só do próprio app, sem `eval`, `object-src 'none'`, `frame-src 'none'`. `style-src` permite `'unsafe-inline'` (estilos dinâmicos) e `connect-src`/`img-src` aceitam `https:` porque o fediverso exige falar com qualquer instância. O GitHub Pages não deixa definir cabeçalhos HTTP, por isso não há `frame-ancestors`.
- **Privacidade**: `referrer: no-referrer` (mídia remota não sabe de onde veio a visita); mensagens diretas não entram no cache local; links externos usam `noopener noreferrer`.
- **Escopos OAuth**: `read write push`. Relatar vulnerabilidades: abra uma *issue* privada no repositório ou fale com o dono.

## Manutenção
- Dependências: Dependabot semanal (npm) e mensal (Actions). Atualizar o Rochedo: `npm i github:soumfilipe/rochedo#vX.Y.Z`.
- Testes: `tests/e2e/` tem 36 testes de ponta a ponta (Playwright em Python, com a API do Mastodon simulada por rotas). `pip install playwright` e `npm run test:e2e` (constrói e roda tudo em ~1 min; use `CHROME_PATH` se não quiser o Chromium do Playwright). Para rodar só alguns: `python3 tests/e2e/rodar.py enquete 12`. Cada arquivo é independente e traz a própria API simulada. Rodam também em cada pull request.
- Ao mexer em telas, mantenha o estado em `src/*.svelte.js` (objetos dentro de `$state` precisam ser trocados, não mutados, quando forem `Set`/`Map`).

## Créditos
Ícones: [Hugeicons](https://hugeicons.com) (versão gratuita, licença MIT, em `brand/HUGEICONS-LICENSE.md`), as mesmas formas de [animate-ui.com/docs/icons/hugeicons](https://animate-ui.com/docs/icons/hugeicons). As animações são em CSS (`style.css`).
