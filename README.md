# Paquiderme

Cliente pessoal e estático para o fediverso (API compatível com Mastodon), pensado para rodar no Safari do iPhone como PWA. Sem servidor, sem build, sem dependências.

## Como funciona
- HTML + CSS + JavaScript puro (módulos ES). Tudo roda no navegador.
- Login por OAuth com PKCE direto na instância; o token fica só no `localStorage` do aparelho.
- A URL de retorno do login é calculada em tempo de execução a partir de onde o app está publicado.
- Há um login manual por código colado, para quando o iOS abrir a autorização fora do app instalado.

## Publicar no GitHub Pages
1. Suba estes arquivos na raiz do repositório (branch `main`).
2. Em Settings → Pages: Source = *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. Para usar subdomínio próprio: crie um registro `CNAME` no DNS apontando para `<usuario>.github.io`, grave o subdomínio no arquivo `CNAME` desta pasta e marque *Enforce HTTPS* em Pages.
4. No iPhone: abra o endereço no Safari → Compartilhar → *Adicionar à Tela de Início*. Faça o login **de dentro do app instalado**.

## Desenvolvimento local
```
python3 -m http.server 8765
```
Abra `http://localhost:8765/`. O `localhost` conta como contexto seguro, então o PKCE funciona.

## Atualizações
O service worker usa *stale-while-revalidate*: a versão nova aparece na abertura seguinte. Ao mudar arquivos, aumente `CACHE` em `sw.js`. Em último caso: aba Conta → *Atualizar o app*.

## Próximos passos possíveis
Streaming por WebSocket, push (Web Push direto do Mastodon), perfis, busca, envio de imagens, enquetes, listas.

## Créditos
Ícones: [Hugeicons](https://hugeicons.com) (versão gratuita, licença MIT, em `brand/HUGEICONS-LICENSE.md`), as mesmas formas de [animate-ui.com/docs/icons/hugeicons](https://animate-ui.com/docs/icons/hugeicons). As animações são em CSS (`style.css`).
