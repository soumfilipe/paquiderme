import os
import json
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765/"; HOST = "https://organica.social"
acct = {"id":"1","username":"filipe","acct":"filipe","display_name":"Filipe","avatar":BASE+"brand/logo-mark.svg","avatar_static":BASE+"brand/logo-mark.svg","url":"https://organica.social/@filipe","emojis":[]}
CORS = {"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*"}
posted = []
def handle(route, request):
    url = urlparse(request.url); path = url.path; q = parse_qs(url.query)
    if request.method == "OPTIONS": return route.fulfill(status=200, headers=CORS)
    def js(o, s=200): route.fulfill(status=s, headers={**CORS,"content-type":"application/json"}, body=json.dumps(o))
    if path == "/api/v1/apps": return js({"client_id":"cid","client_secret":"sec"})
    if path == "/oauth/authorize": return route.fulfill(status=302, headers={"location": f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
    if path == "/oauth/token": return js({"access_token":"tok","token_type":"Bearer"})
    if path == "/api/v1/accounts/verify_credentials": return js(acct)
    if path == "/api/v1/instance": return js({"configuration":{"statuses":{"max_characters":500}}})
    if path == "/api/v1/timelines/home": return js([])
    if path == "/api/v1/statuses": posted.append(json.loads(request.post_data)); return js({"id":"99"})
    return js({"error":"x"}, 404)

FAKE_VV = """
(() => {
  const t = new EventTarget();
  const vv = Object.assign(t, { offsetTop: 0, height: window.innerHeight, width: window.innerWidth });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  window.__vv = vv;
})();
"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--no-sandbox"])
    ctx = b.new_context(bypass_csp=True, viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme="light")
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(FAKE_VV)
    page.route(HOST+"/**", handle)
    page.goto(BASE); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector("#fab")
    page.wait_for_timeout(300)
    page.click("#fab"); page.wait_for_selector("#composer[open]")
    # só o texto aparece como campo; CW escondido, sem <select>
    assert page.query_selector("#composer select") is None
    assert page.is_hidden("#cw")
    assert len(page.query_selector_all("#composer input:not([hidden]), #composer textarea")) == 1, "mais de um campo visível"
    page.screenshot(path="/tmp/c1-open.png")

    # simula teclado do iOS: janela visível encolhe e desloca 48px para baixo (página rolada)
    page.evaluate("() => { __vv.offsetTop = 48; __vv.height = 480; __vv.dispatchEvent(new Event('resize')); }")
    top = page.evaluate("document.querySelector('#composer').getBoundingClientRect().top")
    h = page.evaluate("document.querySelector('#composer').getBoundingClientRect().height")
    assert round(top) == 48 and round(h) == 480, (top, h)
    tools_bottom = page.evaluate("document.querySelector('#compose-tools').getBoundingClientRect().bottom")
    assert tools_bottom <= 48 + 480, tools_bottom
    page.screenshot(path="/tmp/c2-keyboard.png")

    # menu de visibilidade
    page.click("#vis-btn"); page.wait_for_selector("#vis-menu:not([hidden])")
    assert len(page.query_selector_all("#vis-menu button")) == 4
    page.screenshot(path="/tmp/c3-menu.png")
    page.click("#vis-menu button >> nth=2")   # só seguidores
    assert page.is_hidden("#vis-menu")
    # alerta de conteúdo
    page.click("#cw-btn"); assert page.is_visible("#cw"); page.fill("#cw", "CW: teste")
    page.fill("#text", "olá fediverso")
    page.screenshot(path="/tmp/c4-cw.png")
    page.click("#post-btn"); page.wait_for_selector(".ro-aviso")
    print("enviado:", posted)
    assert posted[0]["visibility"] == "private" and posted[0]["spoiler_text"] == "CW: teste"

    # segunda vez: CW desligado não vai junto
    page.click("#fab"); page.wait_for_selector("#composer[open]")
    page.click("#cw-btn"); page.fill("#cw", "esquecido"); page.click("#cw-btn")   # liga e desliga
    page.fill("#text", "sem aviso"); page.click("#post-btn"); page.wait_for_timeout(500)
    print("enviado 2:", posted[1])
    assert "spoiler_text" not in posted[1]
    assert posted[1]["visibility"] == "private", "deveria lembrar a última visibilidade"
    print("erros:", errs)
    b.close()
