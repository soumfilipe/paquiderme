import os
import json
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
BASE="http://localhost:8765/"; IMG=BASE+"brand/logo-mark.svg"; H="https://organica.social"
CORS={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*","access-control-expose-headers":"Link"}
me={"id":"1","username":"filipe","acct":"filipe","display_name":"Filipe","avatar":IMG,"avatar_static":IMG,"header":"","header_static":"","url":H+"/@filipe","note":"","fields":[],"emojis":[],"followers_count":1,"following_count":1,"statuses_count":1,"created_at":"2025-03-10T00:00:00Z","locked":False,"bot":False}
def st(i,t,**kw):
    d={"id":str(i),"created_at":"2026-11-19T20:00:00Z","visibility":"public","sensitive":False,"spoiler_text":"","content":f"<p>{t}</p>","url":"https://x/%d"%i,"uri":"https://x/%d"%i,"account":me,"media_attachments":[],"mentions":[],"emojis":[],"reblogs_count":0,"favourites_count":0,"replies_count":0,"reblogged":False,"favourited":False,"reblog":None,"poll":None}
    d.update(kw); return d
FILT=[{"id":"7","title":"Spoilers","context":["home","public"],"expires_at":None,"filter_action":"warn","keywords":[{"id":"70","keyword":"finale","whole_word":True},{"id":"71","keyword":"morreu","whole_word":True}],"statuses":[]}]
filtered=[{"filter":FILT[0],"keyword_matches":["finale"],"status_matches":[]}]
SENT=[]
def handle(route,request):
    url=urlparse(request.url); path=url.path; q=parse_qs(url.query)
    if request.method=="OPTIONS": return route.fulfill(status=200,headers=CORS)
    def js(o,s=200): route.fulfill(status=s,headers={**CORS,"content-type":"application/json"},body=json.dumps(o))
    if path=="/api/v1/apps": return js({"client_id":"c","client_secret":"s"})
    if path=="/oauth/authorize": return route.fulfill(status=302,headers={"location":f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
    if path=="/oauth/token": return js({"access_token":"t","token_type":"Bearer"})
    if path=="/api/v1/accounts/verify_credentials": return js(me)
    if path=="/api/v1/timelines/home": return js([st(10,"TEXTO ESCONDIDO FINALE",filtered=filtered),st(11,"NORMAL")])
    if path in("/api/v1/notifications","/api/v1/lists"): return js([])
    if path=="/api/v1/markers": return js({})
    if path=="/api/v2/instance": return js({"configuration":{}})
    if path=="/api/v1/push/subscription": return js({"error":"x"},404)
    if path.endswith("/statuses"): return js([])
    if path=="/api/v1/accounts/1": return js(me)
    if path=="/api/v2/filters" and request.method=="GET": return js(FILT)
    if path=="/api/v2/filters" and request.method=="POST":
        SENT.append(("POST",json.loads(request.post_data))); return js({**FILT[0],"id":"8","title":"novo"})
    if path.startswith("/api/v2/filters/"):
        if request.method=="PUT": SENT.append(("PUT",path,json.loads(request.post_data))); return js(FILT[0])
        if request.method=="DELETE": SENT.append(("DEL",path)); FILT.clear(); return js({})
    return js({"error":"nm "+path},404)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None,args=["--no-sandbox"])
    ctx=b.new_context(bypass_csp=True,viewport={"width":390,"height":844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers="block")
    page=ctx.new_page(); errs=[]
    page.on("pageerror",lambda e:errs.append(str(e)))
    page.route(H+"/**",handle)
    page.goto(BASE); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector(".status")
    t=page.inner_text("#view"); assert "TEXTO ESCONDIDO" not in t and "Filtrado: Spoilers" in t and "NORMAL" in t, t
    page.click(".status.filtered button"); page.wait_for_timeout(300); print(repr(page.inner_text("#view"))); assert "TEXTO ESCONDIDO" in page.inner_text("#view")
    # gerência
    page.click("#tabs [data-tab=account]"); page.click("[aria-label='Configurações do app']"); page.click("button:has-text('Filtros de palavras')")
    page.wait_for_selector(".linha"); assert "finale, morreu" in page.inner_text("#view")
    page.click("button:has-text('Novo filtro')"); page.wait_for_selector(".edit-save")
    page.click(".edit-save"); assert "nome" in page.inner_text("#filter-error")
    page.fill("input[placeholder='Ex.: Spoilers']","novo"); page.fill("textarea","um\ndois\num")
    page.click(".chip:has-text('Ocultar')"); page.click(".chip:has-text('1 semana')"); page.click(".chip:has-text('Perfis')")
    page.screenshot(path="/tmp/filt.png")
    page.click(".edit-save"); page.wait_for_selector(".linha")
    k,body=SENT[-1]; print(body)
    assert body["title"]=="novo" and body["filter_action"]=="hide" and body["expires_in"]==604800 and "account" in body["context"]
    assert body["keywords_attributes"]==[{"keyword":"um","whole_word":True},{"keyword":"dois","whole_word":True}]
    # editar: remove 'morreu', adiciona 'x'
    page.click("button:has-text('Editar')"); page.wait_for_selector("textarea")
    assert page.input_value("textarea")=="finale\nmorreu"
    page.fill("textarea","finale\nx"); page.click(".edit-save"); page.wait_for_selector(".linha")
    k,path,body=SENT[-1]; print(body)
    assert path=="/api/v2/filters/7" and body["keywords_attributes"]==[{"id":"71","_destroy":True},{"keyword":"x","whole_word":True}] and "expires_in" not in body
    # excluir (duas etapas)
    page.click(".linha button:has-text('Excluir')"); page.click(".linha button:has-text('Confirmar')")
    page.wait_for_function("document.querySelector('#view').innerText.includes('Nenhum filtro') || !document.querySelector('.linha')")
    assert SENT[-1][0]=="DEL"
    # compartilhar
    page.goto(BASE+"?text=Ol%C3%A1%20mundo&url=https%3A%2F%2Fex.com%2Fa&title=T%C3%ADtulo"); page.wait_for_selector("#composer[open]")
    v=page.input_value("#text"); print(repr(v)); assert v=="Título\nOlá mundo\nhttps://ex.com/a", v
    assert "text=" not in page.url
    page.click("#cancel-compose") if False else None
    assert not errs, errs
    print("filtros+share: ok"); b.close()
