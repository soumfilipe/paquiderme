import os
import json
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765/"; HOST = "https://organica.social"
IMG = BASE + "brand/logo-mark.svg"
def acc(i, user, **kw):
    d = {"id":str(i),"username":user,"acct":user,"display_name":user.title(),"avatar":IMG,"avatar_static":IMG,"header":"https://organica.social/headers/original/missing.png","header_static":"https://organica.social/headers/original/missing.png","url":f"https://organica.social/@{user}","note":"","fields":[],"emojis":[],"followers_count":1200,"following_count":34,"statuses_count":5,"created_at":"2025-03-10T00:00:00Z","locked":False,"bot":False,"group":False}
    d.update(kw); return d
me = acc(1, "filipe", note="<p>Meu perfil</p>")
ana = acc(2, "ana@mastodon.social", display_name="Ana :x:", note='<p>Bio da Ana <script>window.__xss=1</script><a href="https://organica.social/tags/lua" class="mention hashtag">#<span>lua</span></a></p>',
          fields=[{"name":"Site","value":'<a href="https://ana.example" rel="me">ana.example</a>',"verified_at":"2026-01-01T00:00:00Z"},{"name":"Local","value":"Rio","verified_at":None}],
          header="http://localhost:8765/icons/icon-512.png", header_static="http://localhost:8765/icons/icon-512.png")
bob = acc(3, "bob")
carl = acc(4, "carl", locked=True, bot=True)
def status(i, content, account, **kw):
    d = {"id":str(i),"created_at":"2026-11-19T20:00:00Z","visibility":"public","sensitive":False,"spoiler_text":"","content":content,"url":"https://x/%d"%i,"uri":"https://x/%d"%i,"account":account,"media_attachments":[],"mentions":[],"emojis":[],"reblogs_count":0,"favourites_count":0,"replies_count":0,"reblogged":False,"favourited":False,"reblog":None,"poll":None}
    d.update(kw); return d
mention_html = '<p>Oi <span class="h-card"><a href="https://organica.social/@bob" class="u-url mention">@<span>bob</span></a></span></p>'
home = [status(30, mention_html, ana, mentions=[{"id":"3","username":"bob","acct":"bob","url":"https://organica.social/@bob"}])]
CORS = {"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*","access-control-expose-headers":"Link"}
calls = []; rel = {"following": False}
followers_p1 = [acc(10+i, f"seg{i}") for i in range(3)]
followers_p2 = [acc(20, "ultimo")]
def handle(route, request):
    url = urlparse(request.url); path = url.path; q = parse_qs(url.query)
    if request.method == "OPTIONS": return route.fulfill(status=200, headers=CORS)
    calls.append((request.method, path, url.query))
    def js(o, s=200, extra=None): route.fulfill(status=s, headers={**CORS,"content-type":"application/json", **(extra or {})}, body=json.dumps(o))
    if path == "/api/v1/apps": return js({"client_id":"cid","client_secret":"sec"})
    if path == "/oauth/authorize": return route.fulfill(status=302, headers={"location": f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
    if path == "/oauth/token": return js({"access_token":"tok","token_type":"Bearer"})
    if path == "/api/v1/accounts/verify_credentials": return js(me)
    if path == "/api/v1/instance": return js({"configuration":{"statuses":{"max_characters":500}}})
    if path == "/api/v1/timelines/home": return js(home)
    if path == "/api/v1/accounts/lookup":
        return js({"error":"nao achei"}, 404)
    if path == "/api/v2/search": return js({"accounts":[bob]})
    if path == "/api/v1/accounts/relationships":
        return js([{"id":q["id[]"][0],"following":rel["following"],"requested":False,"followed_by":True,"blocking":False,"muting":False,"blocked_by":False}])
    if path.endswith("/follow"): rel["following"] = True; return js({"id":"2","following":True,"requested":False,"followed_by":True,"blocking":False,"muting":False,"blocked_by":False})
    if path.endswith("/unfollow"): rel["following"] = False; return js({"id":"2","following":False,"requested":False,"followed_by":True,"blocking":False,"muting":False,"blocked_by":False})
    if path == "/api/v1/accounts/2": return js(ana)
    if path == "/api/v1/accounts/3": return js(bob)
    if path == "/api/v1/accounts/1": return js(me)
    if path == "/api/v1/accounts/4": return js(carl)
    if path.endswith("/statuses") and q.get("pinned"): return js([])
    if path.endswith("/statuses"):
        aid = path.split("/")[4]
        who = {"1":me,"2":ana,"3":bob,"4":carl}.get(aid, ana)
        tag = "MIDIA" if q.get("only_media") else ("POSTS" if q.get("exclude_replies") else "RESPOSTAS")
        return js([status(100+int(aid), f"<p>{tag} de {who['username']}</p>", who)])
    if path.endswith("/followers"):
        if q.get("max_id") == ["555"]: return js(followers_p2)
        return js(followers_p1, extra={"Link": f'<https://organica.social/api/v1/accounts/2/followers?max_id=555>; rel="next"'})
    if path.endswith("/following"): return js([])
    return js({"error":"nao mockado "+path}, 404)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--no-sandbox"])
    ctx = b.new_context(bypass_csp=True, viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme="dark")
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append("console:"+m.text) if m.type=="error" and "404" not in m.text and "WebSocket" not in m.text else None)
    page.route(HOST+"/**", handle)
    page.goto(BASE); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector(".status"); page.wait_for_timeout(300)

    # 1) avatar -> perfil
    page.click(".status .who-link"); page.wait_for_selector(".profile-name")
    page.wait_for_function("document.body.innerText.includes('POSTS de ana')")
    assert page.evaluate("window.__xss") is None, "XSS"
    assert page.query_selector("img.banner") is not None, "banner"
    assert page.query_selector(".field dd.verified .ro-icone") is not None, "campo verificado"
    txt = page.inner_text("body").replace("\xa0", " ")
    assert "1,2 mil" in txt and "seguindo" in txt and "seguidores" in txt, txt[:400]
    page.wait_for_timeout(300); page.screenshot(path="/tmp/p1-profile.png")

    page.screenshot(path="/tmp/badge-ana.png", clip={"x":0,"y":0,"width":390,"height":420})
    # 2) seguir / deixar de seguir
    assert page.inner_text(".profile-actions > span button") == "Seguir"
    page.click(".profile-actions > span button"); page.wait_for_function("document.querySelector('.profile-actions > span button').innerText === 'Seguindo'")
    page.click(".profile-actions > span button"); page.wait_for_function("document.querySelector('.profile-actions > span button').innerText === 'Seguir'")

    # 3) abas
    page.click(".seg-bar.under >> text=Mídia"); page.wait_for_function("document.body.innerText.includes('MIDIA de ana')")
    page.click(".seg-bar.under >> text=Com respostas"); page.wait_for_function("document.body.innerText.includes('RESPOSTAS de ana')")
    assert any(c[1].endswith("/statuses") and "only_media=true" in c[2] for c in calls)

    # 4) seguidores + paginação por Link + abrir perfil da lista
    page.click(".counts .count-btn >> nth=1"); page.wait_for_selector(".account-row")
    assert len(page.query_selector_all(".account-row")) == 3
    page.screenshot(path="/tmp/p2-followers.png")
    page.click("button.more"); page.wait_for_function("document.querySelectorAll('.account-row').length === 4")
    assert any("max_id=555" in c[2] for c in calls), "paginação por Link"
    page.click(".account-row >> nth=3"); page.wait_for_selector(".profile-name >> text=Ultimo")
    # voltar: perfil do 'ultimo' -> volta para a lista? (pilha: ana -> ultimo)
    page.click(".profile-bar button[aria-label=Voltar]"); page.wait_for_selector(".account-row")   # volta para a lista de seguidores
    page.click(".profile-bar button[aria-label=Voltar]"); page.wait_for_selector(".profile-name >> text=Ana")  # fecha a lista
    page.click(".profile-bar button[aria-label=Voltar]"); page.wait_for_selector(".status")
    assert page.query_selector(".profile-name") is None

    # 5) menção abre o perfil (lookup 404 -> busca com resolve)
    page.click(".status a.mention"); page.wait_for_selector(".profile-name >> text=Bob")
    assert any(c[1] == "/api/v2/search" and "resolve=true" in c[2] for c in calls)
    page.click(".profile-bar button[aria-label=Voltar]")

    # 6) aba Conta = meu perfil, engrenagem abre configurações
    page.click('#tabs button[data-tab="account"]'); page.wait_for_selector(".profile-name >> text=Filipe")
    assert page.query_selector(".profile-actions > span button") is None and page.query_selector(".profile-top button:has-text('Editar')") is not None
    page.click("button[aria-label='Configurações do app']"); page.wait_for_selector("text=Conta e moderação")
    assert "Sair" in page.inner_text("body")
    page.screenshot(path="/tmp/p3-settings.png")
    page.click(".profile-bar button[aria-label=Voltar]"); page.wait_for_selector(".profile-name")

    # 7) perfil fechado
    print("erros:", errs)
    b.close()
print("perfil: ok")
