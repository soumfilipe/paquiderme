import os
import json, re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765/"
HOST = "https://organica.social"
acct = {"id":"1","username":"filipe","acct":"filipe","display_name":"Filipe :paq:","avatar":"http://localhost:8765/icons/icon-192.png","avatar_static":"http://localhost:8765/icons/icon-192.png","url":"https://organica.social/@filipe","emojis":[]}
other = {"id":"2","username":"ana","acct":"ana@mastodon.social","display_name":"Ana <script>window.__xss=1</script>","avatar":"http://localhost:8765/icons/icon-192.png","avatar_static":"http://localhost:8765/icons/icon-192.png","url":"https://mastodon.social/@ana","emojis":[]}
def status(i, content, **kw):
    d = {"id":str(i),"created_at":"2026-11-18T20:00:00Z","visibility":"public","sensitive":False,"spoiler_text":"","content":content,"url":"https://mastodon.social/@ana/%d"%i,"uri":"https://mastodon.social/@ana/%d"%i,"account":other,"media_attachments":[],"mentions":[],"emojis":[],"reblogs_count":2,"favourites_count":5,"replies_count":1,"reblogged":False,"favourited":False,"reblog":None,"poll":None}
    d.update(kw); return d
home = [
  status(30, '<p>Olá <a href="https://mastodon.social/tags/fediverso" class="mention hashtag">#<span>fediverso</span></a> <img src=x onerror="window.__xss=2"><script>window.__xss=3</script></p>'),
  status(29, '<p>Texto com aviso</p>', spoiler_text="CW: política"),
  status(28, '<p>Sensível</p>', sensitive=True, media_attachments=[{"id":"9","type":"image","url":"http://localhost:8765/icons/icon-512.png","preview_url":"http://localhost:8765/icons/icon-512.png","description":"um elefante"}]),
  status(27, '', reblog=status(20, '<p>Post impulsionado</p>')),
]
notifs = [{"id":"n1","type":"favourite","created_at":"2026-11-18T21:00:00Z","account":other,"status":status(15,'<p>Meu post</p>')},
          {"id":"n2","type":"follow","created_at":"2026-11-18T21:10:00Z","account":other,"status":None}]
calls = []

def handle(route, request):
    url = urlparse(request.url); path = url.path; m = request.method
    cors = {"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*"}
    if m == "OPTIONS": return route.fulfill(status=200, headers=cors)
    calls.append((m, path))
    def js(o, s=200): route.fulfill(status=s, headers={**cors,"content-type":"application/json"}, body=json.dumps(o))
    if path == "/api/v1/apps": return js({"client_id":"cid","client_secret":"sec"})
    if path == "/oauth/authorize":
        q = parse_qs(url.query)
        assert q["code_challenge_method"] == ["S256"] and q["code_challenge"][0]
        return route.fulfill(status=302, headers={"location": f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
    if path == "/oauth/token":
        body = request.post_data or ""
        assert "code_verifier=" in body and "grant_type=authorization_code" in body, body
        return js({"access_token":"tok","token_type":"Bearer"})
    if path == "/api/v1/accounts/verify_credentials": return js(acct)
    if path == "/api/v1/instance": return js({"configuration":{"statuses":{"max_characters":2000}}})
    if path == "/api/v1/timelines/home": return js(home if "max_id" not in url.query else [])
    if path == "/api/v1/notifications": return js(notifs)
    if re.match(r"/api/v1/statuses/\d+/favourite", path):
        s = dict(home[0]); s.update(favourited=True, favourites_count=6); return js(s)
    if path == "/api/v1/statuses" and m == "POST":
        calls.append(("BODY", request.post_data, request.headers.get("idempotency-key")))
        return js(status(99, "<p>novo</p>"))
    return js({"error":"nao mockado "+path}, 404)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--no-sandbox"])
    ctx = b.new_context(bypass_csp=True, viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme="dark")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append("console:"+m.text) if m.type=="error" else None)
    page.route(HOST+"/**", handle)
    page.goto(BASE)
    page.wait_for_selector("#login:not([hidden])")
    page.screenshot(path="/tmp/s1-login.png")
    page.click("#login-form button.ro-botao--principal")
    page.wait_for_selector(".status", timeout=8000)
    assert page.evaluate("window.__xss") is None, "XSS executou!"
    assert page.url == BASE, page.url
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/s2-home.png")
    # favoritar
    page.click(".status .actions button.fav")
    page.wait_for_function("document.querySelector('.status .actions button.fav').classList.contains('on')")
    page.screenshot(path="/tmp/s2b-fav.png", clip={"x":0,"y":50,"width":390,"height":200})
    # revelar sensível
    page.click(".media.sensitive")
    # compor
    page.click("#fab"); page.fill("#text", "teste do paquiderme"); page.click("#vis-btn"); page.click("#vis-menu [role=menuitemradio]:nth-child(2)")
    page.screenshot(path="/tmp/s3-compose.png")
    page.click("#post-btn")
    page.wait_for_selector(".ro-aviso")
    # avisos e conta
    page.click('#tabs button[data-tab="notifications"]'); page.wait_for_selector(".notif")
    page.screenshot(path="/tmp/s4-notifs.png")
    page.click('#tabs button[data-tab="account"]'); page.wait_for_selector(".profile-card, .profile-head, .profile-name")
    page.screenshot(path="/tmp/s5-account.png")
    # recarrega: sessão persiste
    page.reload(); page.wait_for_selector(".status", timeout=8000)
    sw = page.evaluate("navigator.serviceWorker.getRegistrations().then(r=>r.length)")
    print("service workers:", sw)
    print("erros de página/console:", errs)
    print("chamadas:", [c for c in calls if c[0] != "OPTIONS"])
    b.close()
