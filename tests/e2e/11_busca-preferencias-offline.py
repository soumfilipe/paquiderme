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
LISTS=[{'id':'50','title':'Amigos','replies_policy':'list'}]; MEM={}
SENT=[]; PUSH=[]
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
    if path == "/api/v2/search":
        t=q.get("type",[""])[0]; off=int(q.get("offset",["0"])[0])
        r={"accounts":[bob],"hashtags":[{"name":"lua","url":"x","history":[{"day":"1","uses":"3","accounts":"2"}]}],"statuses":[status(95,"<p>ACHADA "+q["q"][0]+"</p>",ana)]}
        if t: r={k:(v if k==t else []) for k,v in r.items()}
        if t=="statuses" and off>0: r["statuses"]=[]
        return js(r)
    if path == "/api/v1/accounts/relationships":
        return js([{"id":q["id[]"][0],"following":rel["following"],"requested":False,"followed_by":True,"blocking":False,"muting":False,"blocked_by":False}])
    if path.endswith("/follow"): rel["following"] = True; return js({"id":"2","following":True,"requested":False,"followed_by":True,"blocking":False,"muting":False,"blocked_by":False})
    if path.endswith("/unfollow"): rel["following"] = False; return js({"id":"2","following":False,"requested":False,"followed_by":True,"blocking":False,"muting":False,"blocked_by":False})
    if path == "/api/v1/accounts/2": return js(ana)
    if path == "/api/v1/accounts/3": return js(bob)
    if path == "/api/v1/accounts/1": return js(me)
    if path == "/api/v1/accounts/4": return js(carl)
    if request.method!="GET" and request.post_data: SENT.append((request.method,path,request.post_data))
    elif request.method!="GET": SENT.append((request.method,path,None))
    if path.endswith("/bookmark"): return js(status(30,mention_html,ana,bookmarked=True))
    if path.endswith("/unbookmark"): return js(status(30,mention_html,ana,bookmarked=False))
    if path == "/api/v1/bookmarks": return js([status(80,"<p>SALVO UM</p>",bob,bookmarked=True)])
    if path == "/api/v1/favourites": return js([status(81,"<p>FAVORITO UM</p>",bob)])
    if path.endswith("/pin"): return js(status(101,"<p>meu</p>",me,pinned=True))
    if path.endswith("/mute"): return js({"id":"2","following":False,"requested":False,"followed_by":True,"blocking":False,"muting":True,"blocked_by":False})
    if path.endswith("/block"): return js({"id":"2","following":False,"requested":False,"followed_by":True,"blocking":True,"muting":False,"blocked_by":False})
    if path == "/api/v1/reports": return js({"id":"1"})
    if path == "/api/v1/mutes": return js([carl])
    if path == "/api/v1/blocks": return js([])
    if path.endswith("/unmute"): return js({"id":"4","muting":False,"blocking":False,"following":False,"requested":False,"followed_by":False,"blocked_by":False})
    if path == "/api/v2/instance": return js({"configuration":{"vapid":{"public_key":"BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U"}}})
    if path == "/api/v1/push/subscription":
        if request.method=="GET": return js({"error":"x"},404) if not PUSH else js(PUSH[0])
        d=json.loads(request.post_data or "{}")
        if request.method=="POST": PUSH[:] = [{"id":"1","endpoint":d["subscription"]["endpoint"],"alerts":d["data"]["alerts"]}]; return js(PUSH[0])
        if request.method=="PUT": PUSH[0]["alerts"]=d["data"]["alerts"]; return js(PUSH[0])
        if request.method=="DELETE": PUSH.clear(); return js({})
    if path == "/api/v1/lists" and request.method == "GET": return js([dict(l) for l in LISTS])
    if path == "/api/v1/lists" and request.method == "POST":
        t=json.loads(request.post_data)["title"]; l={"id":str(50+len(LISTS)),"title":t,"replies_policy":"list"}; LISTS.append(l); return js(l)
    if path.startswith("/api/v1/lists/") and path.endswith("/accounts"):
        lid=path.split("/")[4]; mem=MEM.setdefault(lid,[bob])
        if request.method=="GET": return js(mem)
        ids=json.loads(request.post_data)["account_ids"]
        pool={"2":ana,"3":bob,"4":carl}
        if request.method=="POST": mem.extend(pool[i] for i in ids if pool[i] not in mem)
        else: mem[:]=[m for m in mem if m["id"] not in ids]
        return js({})
    if path.startswith("/api/v1/lists/"):
        lid=path.split("/")[4]; l=[x for x in LISTS if x["id"]==lid][0]
        if request.method=="PUT": l["title"]=json.loads(request.post_data)["title"]; return js(l)
        if request.method=="DELETE": LISTS.remove(l); return js({})
    if path.startswith("/api/v1/timelines/list/"): return js([status(70,"<p>NA LISTA "+path.split("/")[-1]+"</p>",bob)])
    if path == "/api/v1/accounts/search": return js([carl,bob])
    if path == "/api/v1/accounts/2/lists": return js([l for l in LISTS if ana in MEM.get(l["id"],[])])
    if path == "/api/v1/statuses/30/context":
        return js({"ancestors":[status(28,"<p>RAIZ</p>",bob,id="28"),status(29,"<p>MEIO</p>",carl,id="29",in_reply_to_id="28")],
                   "descendants":[status(31,"<p>RESP1</p>",bob,id="31",in_reply_to_id="30"),status(32,"<p>RESP1A</p>",me,id="32",in_reply_to_id="31"),status(33,"<p>RESP2</p>",carl,id="33",in_reply_to_id="30")]})
    if path == "/api/v1/statuses/30": return js(status(30,mention_html,ana,favourites_count=7))
    if path == "/api/v1/statuses": return js(status(99,"<p>nova</p>",me))
    if path.endswith("/statuses") and q.get("pinned"):
        return js([status(900,"<p>FIXADA DELA</p>",me)] if path.split("/")[4]=="1" else [])
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


OFFLINE=[False]
def handle2(route, request):
    if OFFLINE[0] and request.url.startswith(HOST+"/api/"): return route.abort()
    return handle(route, request)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--no-sandbox"])
    ctx = b.new_context(bypass_csp=True, viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme="dark", service_workers="block")
    page = ctx.new_page(); errs=[]
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append("console:"+m.text) if m.type=="error" and "404" not in m.text and "WebSocket" not in m.text and "Failed to load" not in m.text and "ERR_FAILED" not in m.text else None)
    page.route(HOST+"/**", handle2)
    page.goto(BASE); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector(".status"); page.wait_for_timeout(500)

    # ---- busca
    page.click("#tabs button[data-tab=explore]"); page.wait_for_selector("#search-dock:not([hidden])")
    page.fill("#search-input","lua"); page.press("#search-input","Enter")
    page.wait_for_function("document.body.innerText.includes('ACHADA lua')")
    txt=page.inner_text("#view"); assert "CONTAS" in txt.upper() and "HASHTAGS" in txt.upper() and "#lua" in txt, txt[:300]
    page.click(".chip:has-text('Contas')"); page.wait_for_function("!document.querySelector('.status') && document.querySelector('.account-row')")
    page.click(".chip:has-text('Publicações')"); page.wait_for_selector(".status")
    page.click(".chip:has-text('Tudo')"); page.wait_for_selector("h3.section"); page.click(".tag-row"); page.wait_for_function("document.body.innerText.includes('#lua')")
    print("busca ok")

    # ---- preferências
    page.click("#tabs button[data-tab=account]"); page.click("[aria-label='Configurações do app']"); page.wait_for_selector("text=Aparência e comportamento")
    page.click(".ro-chip:has-text('Escuro')"); assert page.evaluate("document.documentElement.dataset.theme")=="dark"
    page.click(".ro-chip:has-text('Claro')"); assert page.evaluate("document.documentElement.dataset.theme")=="light"
    bg=page.evaluate("getComputedStyle(document.body).backgroundColor"); assert bg=="rgb(244, 241, 250)", bg
    page.click(".ro-chip:has-text('Maior')"); assert page.evaluate("document.documentElement.style.getPropertyValue('--text-adjust')")=="125%"
    page.click(".ro-chip:has-text('Reduzir')"); assert page.evaluate("document.documentElement.dataset.motion")=="reduce"
    page.click(".ro-chip:has-text('Só seguidores')")
    page.click("label:has-text('Abrir avisos') [role=switch]")
    page.screenshot(path="/tmp/pf1.png")
    page.click(".profile-bar .icon-btn"); page.click("#tabs button[data-tab=home]"); page.click("#fab"); page.wait_for_selector("#composer[open]")
    assert page.get_attribute("#vis-btn","title")=="Só seguidores", page.get_attribute("#vis-btn","title")
    page.click("#cancel-compose")
    print("prefs ok")

    # ---- offline
    page.click("#tabs button[data-tab=home]"); page.wait_for_selector("#view .status"); page.wait_for_timeout(300)
    assert page.evaluate("document.querySelector('details.cw')===null || document.querySelector('details.cw').open")
    ctx2 = b.new_context(bypass_csp=True, viewport={"width":390,"height":844}, service_workers="block")
    # mesma sessão/localStorage: reabre a página na mesma aba, agora sem rede
    OFFLINE[0]=True
    page.reload(); page.wait_for_selector("#view .status"); page.wait_for_function("document.querySelector('.cache-note') && document.querySelector('.cache-note').innerText.includes('Sem conexão')")
    page.screenshot(path="/tmp/pf2.png")
    OFFLINE[0]=False
    # volta online: aviso some após atualizar
    page.evaluate("window.scrollTo(0,0)"); 
    page.click("#tabs button[data-tab=notifications]"); page.click("#tabs button[data-tab=home]"); page.wait_for_timeout(600)
    print("erros:", errs); assert not errs; print("busca/prefs/offline: ok"); b.close()
