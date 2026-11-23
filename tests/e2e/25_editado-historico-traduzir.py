import os
import json
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
BASE="http://localhost:8765/"; IMG=BASE+"brand/logo-mark.svg"; H="https://organica.social"
CORS={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*","access-control-expose-headers":"Link"}
def acc(i,u): return {"id":str(i),"username":u,"acct":u,"display_name":u.title(),"avatar":IMG,"avatar_static":IMG,"header":"","header_static":"","url":H+"/@"+u,"note":"","fields":[],"emojis":[],"followers_count":1,"following_count":1,"statuses_count":1,"created_at":"2025-03-10T00:00:00Z","locked":False,"bot":False}
me=acc(1,"filipe"); ana=acc(30,"ana"); bob=acc(31,"bob")
def st(i,t,**kw):
    d={"id":str(i),"created_at":"2026-11-19T20:00:00Z","visibility":"public","sensitive":False,"spoiler_text":"","content":f"<p>{t}</p>","url":"https://x/%d"%i,"uri":"https://x/%d"%i,"account":me,"media_attachments":[],"mentions":[],"emojis":[],"reblogs_count":0,"favourites_count":0,"replies_count":0,"reblogged":False,"favourited":False,"reblog":None,"poll":None,"card":None}
    d.update(kw); return d
LOG=[]; FOLLOW={"lua":False}; FOLLOW["fediverso"]=False
def handle(route,request):
    url=urlparse(request.url); path=url.path; q=parse_qs(url.query)
    if request.method=="OPTIONS": return route.fulfill(status=200,headers=CORS)
    def js(o,s=200): route.fulfill(status=s,headers={**CORS,"content-type":"application/json"},body=json.dumps(o))
    if path=="/api/v1/apps": return js({"client_id":"c","client_secret":"s"})
    if path=="/oauth/authorize": return route.fulfill(status=302,headers={"location":f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
    if path=="/oauth/token": return js({"access_token":"t","token_type":"Bearer"})
    if path=="/api/v1/accounts/verify_credentials": return js(me)
    if path=="/api/v1/timelines/home": return js([st(11,"POST ESTRANGEIRO",account=ana,favourites_count=2,reblogs_count=1,edited_at="2026-11-19T21:00:00Z",language="en"),st(12,"Normal em pt",language="pt")])
    if path=="/api/v1/notifications":
        if q.get("types[]")==["mention"]: LOG.append("mentions"); return js([{"id":"5","type":"mention","created_at":"2026-11-19T22:00:00Z","account":bob,"status":st(70,"MENCAO UNICA",account=bob)}])
        return js([{"id":"9","type":"follow_request","created_at":"2026-11-19T22:30:00Z","account":bob,"status":None},{"id":"5","type":"mention","created_at":"2026-11-19T22:00:00Z","account":bob,"status":st(70,"MENCAO UNICA",account=bob)}])
    if path=="/api/v1/conversations": return js([{"id":"c1","unread":True,"accounts":[ana],"last_status":st(80,"Oi, tudo bem? <b>DM</b>",account=ana,visibility="direct")}])
    if path=="/api/v1/conversations/c1/read": LOG.append("read"); return js({})
    if path.startswith("/api/v1/follow_requests/"): LOG.append(path.split("/")[-2:]); return js({"id":"31"})
    if path in("/api/v1/lists",): return js([])
    if path=="/api/v1/markers": return js({})
    if path=="/api/v2/instance": return js({"configuration":{"translation":{"enabled":True}}})
    if path=="/api/v1/push/subscription": return js({"error":"x"},404)
    if path=="/api/v1/statuses/11/favourited_by": return js([bob])
    if path=="/api/v1/statuses/11/history": return js([{"content":"<p>VERSAO ANTIGA</p>","spoiler_text":"","created_at":"2026-11-19T20:00:00Z","emojis":[]},{"content":"<p>VERSAO NOVA</p>","spoiler_text":"","created_at":"2026-11-19T21:00:00Z","emojis":[]}])
    if path=="/api/v1/statuses/11/translate": LOG.append(("tr",json.loads(request.post_data))); return js({"content":"<p>TRADUZIDO PARA PT</p>","detected_source_language":"en","provider":"DeepL"})
    if path=="/api/v1/tags/lua": return js({"name":"lua","following":FOLLOW["lua"]})
    if path=="/api/v1/tags/lua/follow": FOLLOW["lua"]=True; return js({"name":"lua","following":True})
    if path=="/api/v1/tags/lua/unfollow": FOLLOW["lua"]=False; return js({"name":"lua","following":False})
    if path=="/api/v1/timelines/tag/lua": return js([st(90,"POST DA TAG")])
    if path=="/api/v1/followed_tags": return js([{"name":"lua"},{"name":"ficcao"}] if FOLLOW["lua"] else [{"name":"ficcao"}])
    if path=="/api/v1/accounts/30/featured_tags": return js([{"id":"1","name":"lua","statuses_count":"4"}])
    if path.endswith("/featured_tags"): return js([])
    if path=="/api/v1/accounts/30": return js(ana)
    if path=="/api/v1/accounts/relationships": return js([{"id":"30","following":False,"followed_by":False}])
    if path.endswith("/statuses"): return js([])
    return js({"error":"nm "+path},404)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None,args=["--no-sandbox"])
    ctx=b.new_context(bypass_csp=True,viewport={"width":390,"height":844},device_scale_factor=2,is_mobile=True,has_touch=True,locale="pt-BR",service_workers="block")
    page=ctx.new_page(); errs=[]
    page.on("pageerror",lambda e:errs.append(str(e)))
    page.route(H+"/**",handle)
    page.goto(BASE); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector(".status")
    # editado + histórico
    page.click(".status .edited"); page.wait_for_selector(".ro-folha[open] .hist-item")
    t=page.inner_text(".ro-folha[open]"); assert t.index("VERSAO NOVA")<t.index("VERSAO ANTIGA"), t
    page.keyboard.press("Escape")
    # traduzir
    page.screenshot(path="/tmp/tr1.png")
    page.click(".tr-btn"); page.wait_for_function("document.querySelector('#view').innerText.includes('TRADUZIDO PARA PT')")
    assert ("tr",{"lang":"pt"}) in LOG or any(isinstance(x,tuple) and x[0]=="tr" for x in LOG)
    assert "Traduzido de EN por DeepL" in page.inner_text("#view")
    page.click(".tr-note .link"); page.wait_for_timeout(300); print(repr(page.inner_text("#view")[:200])); assert "POST ESTRANGEIRO" in page.inner_text("#view")
    assert page.locator(".tr-btn").count()==0 and page.locator(".status:has-text('Normal em pt') .tr-btn").count()==0
    # quem favoritou
    page.click(".status >> nth=0 >> .more-btn"); page.click(".ro-folha .ro-folha__item:has-text('Quem favoritou')")
    page.wait_for_selector(".account-row"); assert "Bob" in page.inner_text("#view")
    page.go_back() if False else page.click("[aria-label='Voltar']")
    # avisos: abas
    page.click("#tabs [data-tab=notifications]"); page.wait_for_selector(".req-actions")
    page.click(".req-actions button:has-text('Aceitar')"); page.wait_for_function("document.querySelector('.req-actions').innerText.includes('Pedido aceito')")
    assert ["31","authorize"] in LOG or ["31", "authorize"] in [list(x) for x in LOG if isinstance(x,list)], LOG
    page.click(".seg-bar button:has-text('Menções')")
    page.wait_for_function("document.querySelector('#view').innerText.includes('MENCAO UNICA')"); assert "quer seguir" not in page.inner_text("#view")
    page.click(".seg-bar button:has-text('Mensagens')"); page.wait_for_selector(".conv.unread")
    assert "DM" in page.inner_text(".conv"); page.screenshot(path="/tmp/dm.png")
    page.click(".conv"); page.wait_for_function("document.querySelector('#view').innerText.includes('Oi, tudo bem')"); assert "read" in LOG
    page.click("[aria-label='Voltar']") if page.locator("[aria-label='Voltar']").count() else None
    # hashtags
    page.click("#tabs [data-tab=explore]"); page.click(".seg-bar button:has-text('Hashtags')"); page.wait_for_selector(".tag-row")
    assert "ficcao" in page.inner_text("#view") and "lua" not in page.inner_text("#view")
    page.evaluate("1"); 
    # abrir tag pelo perfil em destaque: perfil da Ana
    page.click("#tabs [data-tab=home]"); page.click(".status >> nth=0 >> .who-link"); page.wait_for_selector(".featured-tags")
    page.click(".featured-tags .chip")
    page.wait_for_selector(".tag-head .chip:has-text('Seguir')"); page.click(".tag-head .chip")
    page.wait_for_selector(".tag-head .chip[aria-pressed=true]"); assert "Seguindo" in page.inner_text(".tag-head")
    assert FOLLOW["lua"] is True
    page.click(".tag-head [aria-label='Voltar']"); page.click(".seg-bar button:has-text('Hashtags')")
    page.wait_for_function("document.querySelector('#view').innerText.includes('lua')")
    page.click(".tag-row:has-text('lua') button:has-text('Deixar de seguir')"); page.wait_for_function("!document.querySelector('#view').innerText.includes('#lua')")
    assert FOLLOW["lua"] is False
    page.evaluate("1")
    page.click("#tabs [data-tab=explore]") 
    assert not errs, errs
    print("#18-#22: ok"); b.close()
