#!/usr/bin/env python3
"""Roda os testes de ponta a ponta (Playwright, API do Mastodon simulada) contra o app já construído em dist/.

Uso:  npm run test:e2e            (constrói e roda tudo)
      python3 tests/e2e/rodar.py 12 enquete   (só os arquivos cujo nome contém algum dos termos)

Cada arquivo é independente: sobe a própria API simulada pelas rotas do Playwright, entra no app e confere o
comportamento. Variáveis: CHROME_PATH (Chrome/Chromium; senão usa o do Playwright), TESTE_PARALELO (padrão 4).
"""
import concurrent.futures as cf
import os
import pathlib
import socket
import subprocess
import sys
import time

AQUI = pathlib.Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
PORTA = 8765  # os testes apontam para http://localhost:8765/

def porta_livre():
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', PORTA)) != 0

def rodar(arq, env):
    t0 = time.time()
    try:
        r = subprocess.run([sys.executable, str(arq)], capture_output=True, text=True, timeout=180, env=env)
        return arq, r.returncode == 0, (r.stdout + r.stderr)[-1500:], time.time() - t0
    except subprocess.TimeoutExpired:
        return arq, False, 'tempo esgotado (180 s)', time.time() - t0

def main():
    if not (RAIZ / 'dist' / 'index.html').exists():
        sys.exit('dist/ não existe: rode "npm run build" antes.')
    filtros = sys.argv[1:]
    testes = sorted(p for p in AQUI.glob('[0-9]*.py') if not filtros or any(f in p.name for f in filtros))
    servidor = None
    if porta_livre():
        servidor = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORTA), '--directory', str(RAIZ / 'dist')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1)
    env = dict(os.environ)
    if 'CHROME_PATH' not in env and os.path.exists('/usr/bin/google-chrome'):
        env['CHROME_PATH'] = '/usr/bin/google-chrome'
    falhas = []
    try:
        with cf.ThreadPoolExecutor(int(os.environ.get('TESTE_PARALELO', '4'))) as ex:
            for arq, ok, saida, dt in ex.map(lambda a: rodar(a, env), testes):
                print(f"{'ok   ' if ok else 'FALHA'} {arq.name} ({dt:.0f} s)")
                if not ok:
                    falhas.append(arq.name)
                    print('      ' + saida.strip().replace('\n', '\n      '))
    finally:
        if servidor:
            servidor.terminate()
    print(f'\n{len(testes) - len(falhas)}/{len(testes)} passaram')
    sys.exit(1 if falhas else 0)

main()
