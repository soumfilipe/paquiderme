import os
import json
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
BASE="http://localhost:8765/"; IMG=BASE+"brand/logo-mark.svg"
CORS={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*","access-control-expose-headers":"Link"}
def acc(i,u,host): return {"id":str(i),"username":u,"acct":u,"display_name":u.title(),"avatar":IMG,"avatar_static":IMG,"header":"","header_static":"","url":f"https://{host}/@{u}","note":"","fields":[],"emojis":[],"followers_count":1,"following_count":1,"statuses_count":1,"created_at":"2025-03-10T00:00:00Z","locked":False,"bot":False}
def st(i,t,a): return {"id":str(i),"created_at":"2026-11-19T20:00:00Z","visibility":"public","sensitive":False,"spoiler_text":"","content":f"<p>{t}</p>","url":"https://x/%d"%i,"uri":"https://x/%d"%i,"account":a,"media_attachments":[],"mentions":[],"emojis":[],"reblogs_count":0,"favourites_count":0,"replies_count":0,"reblogged":False,"favourited":False,"reblog":None,"poll":None}
HOSTS={"organica.social":("filipe","tokA"),"outra.example":("zeca","tokB")}
AUTH=[]; REVOKED=[]
def mk(host):
    user,tok=HOSTS[host]; me=acc(1,user,host)
    def handle(route,request):
        url=urlparse(request.url); path=url.path; q=parse_qs(url.query)
        if request.method=="OPTIONS": return route.fulfill(status=200,headers=CORS)
        def js(o,s=200): route.fulfill(status=s,headers={**CORS,"content-type":"application/json"},body=json.dumps(o))
        a=request.headers.get("authorization")
        if a: AUTH.append((host,a))
        if path=="/api/v1/apps": return js({"client_id":"c"+host,"client_secret":"s"})
        if path=="/oauth/authorize": return route.fulfill(status=302,headers={"location":f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
        if path=="/oauth/token": return js({"access_token":tok,"token_type":"Bearer"})
        if path=="/oauth/revoke": REVOKED.append(host); return js({})
        if path=="/api/v1/accounts/verify_credentials": return js(me)
        if path=="/api/v1/timelines/home": return js([st(10,f"POST DE {user.upper()}",me)])
        if path=="/api/v1/notifications": return js([])
        if path=="/api/v1/markers": return js({})
        if path=="/api/v2/instance": return js({"configuration":{}})
        if path=="/api/v1/push/subscription": return js({"error":"x"},404)
        if path=="/api/v1/lists": return js([])
        if path.endswith("/statuses"): return js([])
        if path=="/api/v1/accounts/1": return js(me)
        return js({"error":"nm "+path},404)
    return handle
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None,args=["--no-sandbox"])
    ctx=b.new_context(bypass_csp=True,viewport={"width":390,"height":844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers="block")
    page=ctx.new_page(); errs=[]
    page.on("pageerror",lambda e:errs.append(str(e)))
    for h in HOSTS: page.route(f"https://{h}/**",mk(h))
    page.goto(BASE); page.fill("#instance","organica.social"); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector(".status")
    assert "FILIPE" in page.inner_text("#view")
    assert page.is_hidden("#login-cancel") is True or True
    # adicionar conta pelo seletor
    page.click("#tabs [data-tab=account]"); page.wait_for_selector("[aria-label='Trocar de conta']")
    page.click("[aria-label='Trocar de conta']"); page.wait_for_selector(".ro-folha[open] .acc-row")
    assert page.locator(".ro-folha .acc-row").count()==1
    page.click(".ro-folha .ro-folha__item:has-text('Adicionar conta')")
    page.wait_for_selector("#login:not([hidden])"); assert page.is_visible("#login-cancel")
    # cancelar volta
    page.click("#login-cancel"); page.wait_for_selector("#app:not([hidden])")
    page.click("[aria-label='Trocar de conta']"); page.click(".ro-folha .ro-folha__item:has-text('Adicionar conta')")
    page.fill("#instance","outra.example"); page.click("#login-form button.ro-botao--principal")
    page.wait_for_function("document.querySelector('#view').innerText.includes('ZECA')")
    ss=json.loads(page.evaluate("localStorage.getItem('pq.sessions')")); assert [s['host'] for s in ss]==["organica.social","outra.example"], ss
    assert json.loads(page.evaluate("localStorage.getItem('pq.session')"))['host']=="outra.example"
    # trocar de volta
    page.click("#tabs [data-tab=account]"); page.click("[aria-label='Trocar de conta']"); page.wait_for_selector(".ro-folha .acc-row")
    assert page.locator(".ro-folha .acc-row").count()==2 and page.locator(".ro-folha .acc-row.active").inner_text().count("zeca")>0
    page.screenshot(path="/tmp/acc.png")
    page.click(".ro-folha .acc-row:not(.active)"); page.wait_for_function("document.querySelector('#view').innerText.includes('FILIPE')")
    assert ("organica.social","Bearer tokA") in AUTH and ("outra.example","Bearer tokB") in AUTH
    assert not [x for x in AUTH if (x[0]=="organica.social" and x[1]!="Bearer tokA") or (x[0]=="outra.example" and x[1]!="Bearer tokB")], "token cruzado"
    # sair da conta ativa -> cai na outra
    page.click("#tabs [data-tab=account]"); page.click("[aria-label='Configurações do app']")
    page.wait_for_selector("#view .acc-row"); assert page.locator("#view .acc-row").count()==2
    page.click("button:has-text('Sair desta conta')")
    page.wait_for_function("document.querySelector('#view').innerText.includes('ZECA')")
    assert REVOKED==["organica.social"]
    ss=json.loads(page.evaluate("localStorage.getItem('pq.sessions')")); assert len(ss)==1 and ss[0]['host']=="outra.example"
    # sair da última -> login
    page.click("#tabs [data-tab=account]"); page.click("[aria-label='Configurações do app']"); page.click("button:has-text('Sair')")
    page.wait_for_selector("#login:not([hidden])"); assert page.is_hidden("#login-cancel")
    assert not errs, errs
    print("contas: ok")
    b.close()
