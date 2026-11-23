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
carl = acc(4, "carl", locked=True)
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
    if path == "/api/v1/statuses/30/context":
        return js({"ancestors":[status(28,"<p>RAIZ</p>",bob,id="28"),status(29,"<p>MEIO</p>",carl,id="29",in_reply_to_id="28")],
                   "descendants":[status(31,"<p>RESP1</p>",bob,id="31",in_reply_to_id="30"),status(32,"<p>RESP1A</p>",me,id="32",in_reply_to_id="31"),status(33,"<p>RESP2</p>",carl,id="33",in_reply_to_id="30"),status(34,"<p>RESP1AA</p>",bob,id="34",in_reply_to_id="32")]})
    if path == "/api/v1/statuses/30": return js(status(30,mention_html,ana,favourites_count=7))
    if path == "/api/v1/statuses": return js(status(99,"<p>nova</p>",me))
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
    page = ctx.new_page(); errs=[]
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append("console:"+m.text) if m.type=="error" and "404" not in m.text and "WebSocket" not in m.text else None)
    page.route(HOST+"/**", handle)
    page.goto(BASE); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector(".status"); page.wait_for_timeout(300)
    # menção abre perfil (não conversa)
    page.click(".status a.mention"); page.wait_for_selector(".profile-name"); page.click(".profile-bar .icon-btn"); page.wait_for_selector(".status")
    # toque no texto abre a conversa
    page.click(".status .body p"); page.wait_for_selector(".thread-item.focal")
    page.wait_for_function("document.body.innerText.includes('RESP2')")
    assert page.query_selector_all(".thread-item.ancestor").__len__()==2
    assert page.query_selector_all(".thread-item.reply").__len__()==4
    d=page.evaluate("[...document.querySelectorAll('.thread-item.reply')].map(e=>e.style.getPropertyValue('--d'))")
    assert d==['1','2','3','1'], d
    assert "7" in page.inner_text(".thread-item.focal .actions"), "contagem atualizada"
    y=page.evaluate("document.querySelector('.thread-item.focal').getBoundingClientRect().top"); assert y < 140, y
    txt=page.eval_on_selector_all('.thread-item.reply .body','e=>e.map(x=>x.innerText)'); assert txt==['RESP1','RESP1A','RESP1AA','RESP2'], txt
    page.screenshot(path="/tmp/t1-thread.png")
    # toque no focal nada; toque em resposta empilha outra conversa
    page.click(".thread-item.focal .body p"); assert len(page.query_selector_all(".thread-item.focal"))==1
    calls_before=len(calls)
    page.click(".thread-item.reply .body p >> nth=0")
    page.wait_for_function("document.body.innerText.includes('Conversa')")
    # voltar x2 retorna à home
    page.click(".profile-bar .icon-btn"); page.wait_for_selector(".thread-item.focal")
    page.click(".profile-bar .icon-btn"); page.wait_for_selector("#view .status")
    # avatar dentro da conversa abre perfil
    page.click(".status .body p"); page.wait_for_selector(".thread-item.focal")
    page.click(".thread-item.ancestor .who-link >> nth=0"); page.wait_for_selector(".profile-name")
    page.click(".profile-bar .icon-btn"); page.wait_for_selector(".thread-item.focal")
    # responder dentro da conversa recarrega
    n=len([c for c in calls if c[1].endswith("/context")])
    page.click(".thread-item.focal .actions button >> nth=0"); page.fill("#text","oi"); page.click("#post-btn")
    page.wait_for_function("1", timeout=1000); page.wait_for_timeout(500)
    assert len([c for c in calls if c[1].endswith("/context")])>n, "recarregou"
    # botão de favoritar não abre conversa
    print("erros:", errs); assert not errs
    print("thread: ok")
    b.close()
