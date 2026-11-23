import os
import json
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
BASE="http://localhost:8765/"; IMG=BASE+"brand/logo-mark.svg"; H="https://organica.social"
CORS={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*","access-control-expose-headers":"Link"}
def acc(i,u): return {"id":str(i),"username":u,"acct":u,"display_name":u.title(),"avatar":IMG,"avatar_static":IMG,"header":"","header_static":"","url":H+"/@"+u,"note":"","fields":[],"emojis":[],"followers_count":1,"following_count":1,"statuses_count":1,"created_at":"2025-03-10T00:00:00Z","locked":False,"bot":False}
me=acc(1,"filipe"); U=[acc(10+i,n) for i,n in enumerate(["ana","bob","carl","dani","edu","fabi","gil","hugo"])]
def st(i,t):
    return {"id":str(i),"created_at":"2026-11-19T20:00:00Z","visibility":"public","sensitive":False,"spoiler_text":"","content":f"<p>{t}</p>","url":"https://x/%d"%i,"uri":"https://x/%d"%i,"account":me,"media_attachments":[],"mentions":[],"emojis":[],"reblogs_count":0,"favourites_count":0,"replies_count":0,"reblogged":False,"favourited":False,"reblog":None,"poll":None}
S1=st(50,"MINHA PUBLICACAO UM"); S2=st(51,"MINHA PUBLICACAO DOIS")
def n(i,t,a,s=None): return {"id":str(i),"type":t,"created_at":"2026-11-19T22:%02d:00Z"%(59-i),"account":a,"status":s}
NOTIFS=[n(1,"favourite",U[0],S1),n(2,"reblog",U[1],S1),n(3,"reblog",U[2],S1),n(4,"favourite",U[3],S2),n(5,"reblog",U[4],S1),n(6,"follow",U[5]),n(7,"follow",U[6]),n(8,"follow",U[7]),n(9,"mention",U[0],st(60,"OI @filipe"))]
SEARCHED=[]; CATCH=[]; LIVE_N=[]
def handle(route,request):
    url=urlparse(request.url); path=url.path; q=parse_qs(url.query)
    if request.method=="OPTIONS": return route.fulfill(status=200,headers=CORS)
    def js(o,s=200): route.fulfill(status=s,headers={**CORS,"content-type":"application/json"},body=json.dumps(o))
    if path=="/api/v1/apps": return js({"client_id":"c","client_secret":"s"})
    if path=="/oauth/authorize": return route.fulfill(status=302,headers={"location":f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
    if path=="/oauth/token": return js({"access_token":"t","token_type":"Bearer"})
    if path=="/api/v1/accounts/verify_credentials": return js(me)
    if path=="/api/v1/timelines/home":
        if "since_id" in q: CATCH.append(q["since_id"][0]); return js([st(41,"PERDIDA NA QUEDA")])
        return js([st(11,"INICIO")])
    if path=="/api/v1/timelines/public": return js([st(12,"PUBLICA LOCAL")])
    if path=="/api/v1/notifications": return js(LIVE_N)
    if path in("/api/v1/lists",): return js([])
    if path=="/api/v1/markers": return js({})
    if path=="/api/v2/instance": return js({"configuration":{}})
    if path=="/api/v1/push/subscription": return js({"error":"x"},404)
    if path=="/api/v2/search": SEARCHED.append(q["q"][0]); return js({"accounts":[U[0]],"hashtags":[],"statuses":[st(70,"ACHADA lua")]})
    if path.endswith("/statuses"): return js([])
    return js({"error":"nm "+path},404)
FAKE = """
window.__sockets=[];
window.WebSocket=class{constructor(u,p){this.url=u;this.protocol=p;this.readyState=0;window.__sockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen&&this.onopen({})},10)}
 close(){this.closed=true;this.readyState=3;this.onclose&&this.onclose({})}
 drop(){this.readyState=3;this.onclose&&this.onclose({})}};
window.__emit=(ev,payload)=>{const s=window.__sockets[window.__sockets.length-1];s.onmessage({data:JSON.stringify({stream:['user'],event:ev,payload:typeof payload==='string'?payload:JSON.stringify(payload)})})};
"""
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None,args=["--no-sandbox"])
    ctx=b.new_context(bypass_csp=True,viewport={"width":390,"height":844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers="block")
    ctx.add_init_script(FAKE)
    page=ctx.new_page(); errs=[]
    page.on("pageerror",lambda e:errs.append(str(e)))
    page.route(H+"/**",handle)
    page.goto(BASE); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector(".status"); page.wait_for_timeout(200)
    assert page.evaluate("__sockets.length")==1
    assert page.evaluate("__sockets[0].url")=="wss://organica.social/api/v1/streaming?stream=user" and page.evaluate("__sockets[0].protocol")=="t"
    # no topo: entra direto
    page.evaluate("__emit('update', %s)" % json.dumps(st(20,"AO VIVO UM")))
    page.wait_for_function("document.querySelector('#view').innerText.includes('AO VIVO UM')")
    assert page.is_hidden("#new-pill")
    # rolando: vira aviso
    page.evaluate("document.querySelector('#view').style.minHeight='3000px'; window.scrollTo(0,500)"); page.wait_for_timeout(100)
    page.evaluate("__emit('update', %s)" % json.dumps(st(21,"AO VIVO DOIS")))
    page.evaluate("__emit('update', %s)" % json.dumps(st(22,"AO VIVO TRES")))
    page.wait_for_selector("#new-pill:not([hidden])"); assert "2 novas publicações" in page.inner_text("#new-pill")
    assert "AO VIVO DOIS" not in page.inner_text("#view")
    page.screenshot(path="/tmp/pill.png")
    page.click("#new-pill"); page.wait_for_function("document.querySelector('#view').innerText.includes('AO VIVO TRES')")
    assert page.evaluate("scrollY")==0 and page.is_hidden("#new-pill")
    t=page.inner_text("#view"); assert t.index("AO VIVO TRES")<t.index("AO VIVO DOIS")<t.index("AO VIVO UM")<t.index("INICIO")
    # editar e apagar
    page.evaluate("__emit('status.update', %s)" % json.dumps(st(21,"DOIS EDITADO")))
    page.wait_for_function("document.querySelector('#view').innerText.includes('DOIS EDITADO')")
    page.evaluate("__emit('delete','22')"); page.wait_for_function("!document.querySelector('#view').innerText.includes('AO VIVO TRES')")
    # notificação fora da aba de avisos acende o sino
    LIVE_N.insert(0,n(3,"favourite",U[0],S1))
    page.evaluate("__emit('notification', %s)" % json.dumps(n(3,"favourite",U[0],S1)))
    page.wait_for_selector("#tabs button.unread")
    page.click("#tabs [data-tab=notifications]"); page.wait_for_function("document.querySelector('#view').innerText.includes('Ana favoritou')")
    page.evaluate("__emit('notification', %s)" % json.dumps(n(4,"reblog",U[1],S1)))
    page.wait_for_function("document.querySelector('#view').innerText.includes('Bob')")
    # queda de conexão -> reconecta (backoff 1s)
    page.evaluate("__sockets[__sockets.length-1].drop()"); page.wait_for_function("__sockets.length==2", timeout=5000)
    # app em segundo plano fecha; volta reabre e busca o que perdeu
    page.evaluate("Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true}); document.dispatchEvent(new Event('visibilitychange'))")
    assert page.evaluate("__sockets[1].closed===true")
    page.evaluate("Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true}); document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_function("__sockets.length==3"); page.wait_for_timeout(300); assert CATCH, "catch-up"
    page.click("#tabs [data-tab=home]"); page.wait_for_selector("#new-pill:not([hidden])")
    # preferência desliga
    page.click("#tabs [data-tab=account]"); page.click("[aria-label='Configurações do app']"); page.click("text=Receber publicações e avisos em tempo real")
    assert page.evaluate("__sockets[__sockets.length-1].closed===true")
    assert not errs, errs
    print("streaming: ok"); b.close()
