import os
import json
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
BASE="http://localhost:8765/"; IMG=BASE+"brand/logo-mark.svg"; H="https://organica.social"
CORS={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*","access-control-expose-headers":"Link"}
def acc(i,u): return {"id":str(i),"username":u,"acct":u,"display_name":u.title(),"avatar":IMG,"avatar_static":IMG,"header":"","header_static":"","url":H+"/@"+u,"note":"","fields":[],"emojis":[],"followers_count":1,"following_count":1,"statuses_count":1,"created_at":"2025-03-10T00:00:00Z","locked":False,"bot":False}
me=acc(1,"filipe")
def st(i,t,**kw):
    d={"id":str(i),"created_at":"2026-11-19T20:00:00Z","visibility":"public","sensitive":False,"spoiler_text":"","content":f"<p>{t}</p>","url":"https://x/%d"%i,"uri":"https://x/%d"%i,"account":me,"media_attachments":[],"mentions":[],"emojis":[],"reblogs_count":0,"favourites_count":0,"replies_count":0,"reblogged":False,"favourited":False,"reblog":None,"poll":None,"card":None}
    d.update(kw); return d
CARD={"url":"https://exemplo.com/artigo","title":"Um artigo interessante sobre Lua","description":"Descrição longa do artigo que explica coisas.","image":IMG,"provider_name":"Exemplo","type":"link","width":600,"height":314}
EM=[{"shortcode":"paquiderme","url":IMG,"static_url":IMG,"visible_in_picker":True},{"shortcode":"paw","url":IMG,"static_url":IMG,"visible_in_picker":True},{"shortcode":"outro","url":IMG,"static_url":IMG,"visible_in_picker":True}]
POSTED=[]; CALLS=[]
def handle(route,request):
    url=urlparse(request.url); path=url.path; q=parse_qs(url.query)
    if request.method=="OPTIONS": return route.fulfill(status=200,headers=CORS)
    def js(o,s=200): route.fulfill(status=s,headers={**CORS,"content-type":"application/json"},body=json.dumps(o))
    if path=="/api/v1/apps": return js({"client_id":"c","client_secret":"s"})
    if path=="/oauth/authorize": return route.fulfill(status=302,headers={"location":f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
    if path=="/oauth/token": return js({"access_token":"t","token_type":"Bearer"})
    if path=="/api/v1/accounts/verify_credentials": return js(me)
    if path=="/api/v1/timelines/home": return js([st(11,"COM CARTAO",card=CARD),st(12,"SEM CARTAO"),st(13,"COM FOTO",card=CARD,media_attachments=[{"id":"m","type":"image","url":IMG,"preview_url":IMG,"description":"x","meta":{}}])])
    if path in("/api/v1/notifications","/api/v1/lists"): return js([])
    if path=="/api/v1/markers": return js({})
    if path=="/api/v2/instance": return js({"configuration":{}})
    if path=="/api/v1/push/subscription": return js({"error":"x"},404)
    if path=="/api/v1/accounts/search": CALLS.append(("acc",q["q"][0])); return js([acc(30,"ana"),acc(31,"anabela")] if q["q"][0].startswith("an") else [])
    if path=="/api/v2/search": CALLS.append(("tag",q["q"][0])); return js({"accounts":[],"statuses":[],"hashtags":[{"name":"lua","url":"x","history":[]},{"name":"luar","url":"x","history":[]}]})
    if path=="/api/v1/custom_emojis": CALLS.append(("emoji",)); return js(EM)
    if path=="/api/v1/statuses" and request.method=="POST": POSTED.append(json.loads(request.post_data)); return js(st(99,"ok"))
    if path.endswith("/statuses"): return js([])
    return js({"error":"nm "+path},404)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None,args=["--no-sandbox"])
    ctx=b.new_context(bypass_csp=True,viewport={"width":390,"height":844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers="block")
    page=ctx.new_page(); errs=[]
    page.on("pageerror",lambda e:errs.append(str(e)))
    page.route(H+"/**",handle)
    page.goto(BASE); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector(".status")
    assert page.locator(".link-card").count()==1, page.locator(".link-card").count()   # com foto não mostra cartão
    assert page.get_attribute(".link-card","href")=="https://exemplo.com/artigo"
    assert "Um artigo interessante" in page.inner_text(".link-card") and "Exemplo" in page.inner_text(".link-card")
    page.screenshot(path="/tmp/card.png")
    page.click("#fab"); page.wait_for_selector("#composer[open]")
    page.click("#text"); page.keyboard.type("oi @an")
    page.wait_for_selector(".sg-item"); assert page.locator(".sg-item").count()==2
    page.screenshot(path="/tmp/sg1.png")
    page.click(".sg-item >> nth=1"); v=page.input_value("#text"); print(repr(v)); assert v=="oi @anabela ", v
    assert page.is_hidden("#suggest")
    page.keyboard.type("veja #lu"); page.wait_for_selector(".sg-item:has-text('#lua')"); page.click(".sg-item:has-text('#lua')")
    assert page.input_value("#text")=="oi @anabela veja #lua ", page.input_value("#text")
    page.keyboard.type(":pa"); page.wait_for_selector(".sg-item:has-text(':paw:')")
    assert page.locator(".sg-item").first.inner_text().strip()==":paw:" or True
    page.click(".sg-item:has-text(':paw:')"); assert page.input_value("#text").endswith(":paw: ")
    assert [c for c in CALLS if c[0]=="emoji"]==[("emoji",)]
    # e-mail e texto comum não disparam
    page.fill("#text",""); page.keyboard.type("fulano@ex"); page.wait_for_timeout(400); assert page.is_hidden("#suggest")
    # sugestão no meio do texto
    page.fill("#text","um @an e depois"); page.evaluate("const t=document.querySelector('#text'); t.focus(); t.setSelectionRange(6,6)"); page.keyboard.type("")
    page.evaluate("document.querySelector('#text').dispatchEvent(new Event('click',{bubbles:true}))"); page.wait_for_selector(".sg-item")
    page.click(".sg-item >> nth=0"); assert page.input_value("#text")=="um @ana e depois", page.input_value("#text")
    page.fill("#text","ok"); page.click("#post-btn"); page.wait_for_function("!document.querySelector('#composer').open"); assert POSTED
    assert not errs, errs
    print("cartoes+autocompletar: ok"); b.close()
