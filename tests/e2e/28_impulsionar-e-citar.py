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
NOTIFS=[n(1,"favourite",U[0],S1),n(2,"reblog",U[1],S1),n(3,"reblog",U[2],S1),n(4,"favourite",U[3],S2),n(5,"reblog",U[4],S1),n(6,"follow",U[5]),n(7,"follow",U[6]),n(8,"follow",U[7]),n(9,"mention",U[0],st(62,"OI @filipe"))]
SEARCHED=[]; POSTED=[]; CALLS=[]
REL={'id':'10','following':True,'showing_reblogs':True,'notifying':False,'muting':False,'blocking':False,'requested':False}
THEIRS={**st(60,'DA ANA'),'account':U[0],'mentions':[],'quote':{'state':'accepted','quoted_status':st(61,'TEXTO CITADO')}}
def handle(route,request):
    url=urlparse(request.url); path=url.path; q=parse_qs(url.query)
    if request.method=="OPTIONS": return route.fulfill(status=200,headers=CORS)
    def js(o,s=200): route.fulfill(status=s,headers={**CORS,"content-type":"application/json"},body=json.dumps(o))
    if path=="/api/v1/apps": return js({"client_id":"c","client_secret":"s"})
    if path=="/oauth/authorize": return route.fulfill(status=302,headers={"location":f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
    if path=="/oauth/token": return js({"access_token":"t","token_type":"Bearer"})
    if path=="/api/v1/accounts/verify_credentials": return js(me)
    if path=="/api/v1/timelines/home": return js([THEIRS])
    if path=="/api/v1/timelines/public": return js([st(12,"PUBLICA LOCAL")])
    if path=="/api/v1/notifications": return js(NOTIFS)
    if path in("/api/v1/lists",): return js([])
    if path=="/api/v1/markers": return js({})
    if path=="/api/v2/instance": return js({"configuration":{}})
    if path=="/api/v1/push/subscription": return js({"error":"x"},404)
    if path=="/api/v2/search": SEARCHED.append(q["q"][0]); return js({"accounts":[U[0]],"hashtags":[],"statuses":[st(70,"ACHADA lua")]})
    if path=="/api/v1/accounts/relationships": return js([REL])
    if path=="/api/v1/accounts/10/follow": CALLS.append(json.loads(request.post_data or "{}")); REL.update(showing_reblogs=CALLS[-1].get("reblogs",True),notifying=CALLS[-1].get("notify",False)); return js(REL)
    if path=="/api/v1/statuses/60/mute": CALLS.append("mute60"); return js({**THEIRS,"muted":True})
    if path=="/api/v1/accounts/10": return js(U[0])
    if path=="/api/v1/statuses/60/reblog": POSTED.append(("reblog",json.loads(request.post_data or "{}"))); return js({**st(99,"x"),"reblog":{**THEIRS,"reblogged":True,"reblogs_count":1}})
    if path=="/api/v1/statuses" and request.method=="POST": POSTED.append(("post",json.loads(request.post_data))); return js(st(98,"citando"))
    if path.endswith("/statuses"): return js([])
    return js({"error":"nm "+path},404)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None,args=["--no-sandbox"])
    ctx=b.new_context(bypass_csp=True,viewport={"width":390,"height":844},is_mobile=True,has_touch=True,service_workers="block",locale="pt-BR")
    page=ctx.new_page(); errs=[]
    page.on("pageerror",lambda e:errs.append(str(e)))
    page.on("console",lambda m: m.type=="error" and "WebSocket" not in m.text and "Failed to load" not in m.text and errs.append(m.text))
    page.route(H+"/**",handle)
    page.goto(BASE); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector(".status")
    assert "TEXTO CITADO" in page.inner_text(".status .quote")
    page.screenshot(path="/tmp/quote.png")
    page.click(".status .actions .boost"); page.wait_for_selector(".ro-folha__conteudo")
    t=page.inner_text(".ro-folha__conteudo"); assert "Impulsionar sem listar" in t and "Citar" in t
    page.click("text=Impulsionar sem listar"); page.wait_for_function("1")
    page.wait_for_timeout(400)
    assert ("reblog",{"visibility":"unlisted"}) in [tuple(x) for x in POSTED], POSTED
    page.reload(); page.wait_for_selector(".status")
    page.click(".status .actions .boost"); page.click("text=Citar"); page.wait_for_selector("#composer[open]")
    assert "Citando @ana" in page.inner_text("#reply-to")
    page.fill("#text","minha opinião"); page.click("#post-btn"); page.wait_for_timeout(500)
    posts=[x[1] for x in POSTED if x[0]=="post"]
    assert posts and posts[-1]["quoted_status_id"]=="60", POSTED
    assert not errs, errs
    print("ok"); b.close()
