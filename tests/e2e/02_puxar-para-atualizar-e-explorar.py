import os
import json, re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765/"
HOST = "https://organica.social"
acct = {"id":"1","username":"filipe","acct":"filipe","display_name":"Filipe","avatar":"http://localhost:8765/brand/logo-mark.svg","avatar_static":"http://localhost:8765/brand/logo-mark.svg","url":"https://organica.social/@filipe","emojis":[]}
other = {"id":"2","username":"ana","acct":"ana@mastodon.social","display_name":"Ana","avatar":"http://localhost:8765/brand/logo-mark.svg","avatar_static":"http://localhost:8765/brand/logo-mark.svg","url":"https://mastodon.social/@ana","emojis":[]}
def status(i, content, **kw):
    d = {"id":str(i),"created_at":"2026-11-19T20:00:00Z","visibility":"public","sensitive":False,"spoiler_text":"","content":content,"url":"https://x/%d"%i,"uri":"https://x/%d"%i,"account":other,"media_attachments":[],"mentions":[],"emojis":[],"reblogs_count":0,"favourites_count":0,"replies_count":0,"reblogged":False,"favourited":False,"reblog":None,"poll":None}
    d.update(kw); return d
tagl = '<a href="https://organica.social/tags/fediverso" class="mention hashtag" rel="tag">#<span>fediverso</span></a>'
home = [status(30, f"<p>Home {tagl}</p>")]
home2 = [status(31, f"<p>Home ATUALIZADO {tagl}</p>")]
local = [status(40, "<p>Post LOCAL da minha instância</p>")]
glob = [status(50, "<p>Post GLOBAL federado</p>")]
tagtl = [status(60, "<p>Post da hashtag fediverso</p>")]
other_tl = [status(70, "<p>Post da outra instância</p>")]
trends_tags = [{"name":"fediverso","history":[{"day":"1","uses":str(10+i),"accounts":str(5+i)} for i in range(7)]},
               {"name":"lua","history":[{"day":"1","uses":str(3*(i+1)),"accounts":"2"} for i in range(7)]}]
trends_st = [status(80, "<p>Post EM ALTA</p>")]
calls = []; auth_leak = []
state = {"homeCalls": 0}
CORS = {"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*"}

def mk_handler(is_main):
    def handle(route, request):
        url = urlparse(request.url); path = url.path; q = parse_qs(url.query)
        if request.method == "OPTIONS": return route.fulfill(status=200, headers=CORS)
        if not is_main and request.headers.get("authorization"): auth_leak.append(request.url)
        calls.append((("" if is_main else "OUTRA ")+path, url.query))
        def js(o, s=200): route.fulfill(status=s, headers={**CORS,"content-type":"application/json"}, body=json.dumps(o))
        if not is_main:
            if "blocked.example" in request.url: return js({"error":"nope"}, 422)
            return js(other_tl)
        if path == "/api/v1/apps": return js({"client_id":"cid","client_secret":"sec"})
        if path == "/oauth/authorize":
            return route.fulfill(status=302, headers={"location": f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
        if path == "/oauth/token": return js({"access_token":"tok","token_type":"Bearer"})
        if path == "/api/v1/accounts/verify_credentials": return js(acct)
        if path == "/api/v1/instance": return js({"configuration":{"statuses":{"max_characters":2000}}})
        if path == "/api/v1/timelines/home":
            state["homeCalls"] += 1
            return js(home if state["homeCalls"] == 1 else home2)
        if path == "/api/v1/timelines/public": return js(local if q.get("local") == ["true"] else glob)
        if path.startswith("/api/v1/timelines/tag/"): return js(tagtl)
        if path == "/api/v1/trends/tags": return js(trends_tags)
        if path == "/api/v1/trends/statuses": return js(trends_st)
        if path == "/api/v1/notifications": return js([])
        return js({"error":"nao mockado "+path}, 404)
    return handle

def pull(cdp, x, y0, y1, hold_shot=None, page=None):
    cdp.send("Input.dispatchTouchEvent", {"type":"touchStart","touchPoints":[{"x":x,"y":y0}]})
    steps = 12
    for i in range(1, steps+1):
        cdp.send("Input.dispatchTouchEvent", {"type":"touchMove","touchPoints":[{"x":x,"y":y0+(y1-y0)*i/steps}]})
    if hold_shot: page.screenshot(path=hold_shot)
    cdp.send("Input.dispatchTouchEvent", {"type":"touchEnd","touchPoints":[]})

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--no-sandbox"])
    ctx = b.new_context(bypass_csp=True, viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme="dark")
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append("console:"+m.text) if m.type=="error" else None)
    page.route(HOST+"/**", mk_handler(True))
    page.route("https://mastodon.social/**", mk_handler(False))
    page.route("https://blocked.example/**", mk_handler(False))
    page.goto(BASE); page.wait_for_selector("#login:not([hidden])")
    page.click("#login-form button.ro-botao--principal")
    page.wait_for_selector(".status"); page.wait_for_timeout(500)
    assert page.query_selector("#topbar") is None and page.query_selector("#title") is None, "cabeçalho ainda existe"
    assert len(page.query_selector_all("#tabs button")) == 4
    page.screenshot(path="/tmp/n1-home.png")

    # puxar para atualizar
    cdp = ctx.new_cdp_session(page)
    pull(cdp, 195, 120, 320, hold_shot="/tmp/n2-pull.png", page=page)
    page.wait_for_function("document.body.innerText.includes('Home ATUALIZADO')", timeout=5000)
    page.wait_for_timeout(500)
    assert page.evaluate("document.querySelector('#ptr').classList.contains('loading')") is False
    assert page.evaluate("document.querySelector('#view').style.transform") == "", "view ficou deslocada"
    print("puxar para atualizar: ok")

    # puxar curto NÃO atualiza
    before = state["homeCalls"]
    pull(cdp, 195, 120, 150); page.wait_for_timeout(500)
    assert state["homeCalls"] == before, "puxão curto atualizou"
    print("puxão curto ignorado: ok")

    # Explorar > minha instância
    page.click('#tabs button[data-tab="explore"]'); page.wait_for_selector(".seg-bar")
    page.wait_for_function("document.body.innerText.includes('Post LOCAL')")
    page.screenshot(path="/tmp/n3-explore.png")
    # Global
    page.click(".seg-bar >> text=Global"); page.wait_for_function("document.body.innerText.includes('Post GLOBAL')")
    # Em alta
    page.click(".seg-bar >> text=Em alta"); page.wait_for_selector(".tag-row"); page.wait_for_function("document.body.innerText.includes(\"Post EM ALTA\")")
    assert page.inner_text("body").count("Post EM ALTA") == 1
    page.screenshot(path="/tmp/n4-trends.png")
    # hashtag em alta -> timeline da tag e voltar
    page.click(".tag-row >> nth=0"); page.wait_for_function("document.body.innerText.includes('Post da hashtag')")
    page.screenshot(path="/tmp/n5-tag.png")
    page.click(".tag-head button"); page.wait_for_selector(".tag-row")
    # outras instâncias
    page.click(".seg-bar >> text=Outras"); page.wait_for_selector(".inst-form")
    page.fill(".inst-form input", "https://Mastodon.Social/"); page.click(".inst-form button")
    page.wait_for_function("document.body.innerText.includes('Post da outra instância')")
    assert page.query_selector(".status .actions button") is None, "ações visíveis em modo leitura"
    page.screenshot(path="/tmp/n6-other.png")
    page.fill(".inst-form input", "blocked.example"); page.click(".inst-form button")
    page.wait_for_function("document.body.innerText.includes('não libera')")
    # clique em hashtag num post da home
    page.click('#tabs button[data-tab="home"]'); page.wait_for_selector(".status a.hashtag")
    page.click(".status a.hashtag"); page.wait_for_function("document.body.innerText.includes('Post da hashtag')")
    assert page.evaluate("document.querySelector('#tabs button[aria-current]').dataset.tab") == "explore"
    print("explorar: ok")
    print("token vazou para outra instância:", auth_leak)
    print("erros:", errs)
    print("chamadas:", [c for c in calls if 'OUTRA' in c[0] or 'public' in c[0] or 'trends' in c[0] or 'tag' in c[0]])
    b.close()
