// Depois do `vite build`: copia o que o Vite não empacota (manifesto, ícones, marca, CNAME) e gera o
// service worker de dist/ a partir de sw.js da raiz, trocando a lista SHELL pelos arquivos reais do build
// e a versão do cache por um hash do conteúdo (muda sozinha a cada build; não é mais preciso subir à mão).
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const dist = 'dist';
for (const p of ['manifest.webmanifest', 'icons', 'brand', 'CNAME']) {
  if (existsSync(p)) cpSync(p, join(dist, p), { recursive: true });
}

const arquivos = [];
(function varrer(dir) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho);
    else arquivos.push(relative(dist, caminho).split('\\').join('/'));
  }
})(dist);

const casco = arquivos.filter((f) => f !== 'CNAME' && f !== 'sw.js').sort();
const hash = createHash('sha256');
for (const f of casco) hash.update(f).update(readFileSync(join(dist, f)));
const versao = hash.digest('hex').slice(0, 8);

let sw = readFileSync('sw.js', 'utf8');
sw = sw.replace(/const CACHE = '[^']*';/, `const CACHE = 'paquiderme-${versao}';`);
sw = sw.replace(/const SHELL = \[[\s\S]*?\n\];/, `const SHELL = [\n  './',\n${casco.map((f) => `  '${f}',`).join('\n')}\n];`);
writeFileSync(join(dist, 'sw.js'), sw);
console.log(`dist/: ${casco.length} arquivos no casco, cache paquiderme-${versao}`);
