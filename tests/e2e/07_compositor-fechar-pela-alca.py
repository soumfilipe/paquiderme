import os
import json
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765/"; HOST = "https://organica.social"
acct = {"id":"1","username":"filipe","acct":"filipe","display_name":"Filipe","avatar":BASE+"brand/logo-mark.svg","avatar_static":BASE+"brand/logo-mark.svg","url":"https://organica.social/@filipe","emojis":[]}
CORS = {"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*"}
posted = []
def handle(route, request):
    url = urlparse(request.url); path = url.path; q = parse_qs(url.query)
    if request.method == "OPTIONS": return route.fulfill(status=200, headers=CORS)
    def js(o, s=200): route.fulfill(status=s, headers={**CORS,"content-type":"application/json"}, body=json.dumps(o))
    if path == "/api/v1/apps": return js({"client_id":"cid","client_secret":"sec"})
    if path == "/oauth/authorize": return route.fulfill(status=302, headers={"location": f"{q['redirect_uri'][0]}?code=abc&state={q['state'][0]}"})
    if path == "/oauth/token": return js({"access_token":"tok","token_type":"Bearer"})
    if path == "/api/v1/accounts/verify_credentials": return js(acct)
    if path == "/api/v1/instance": return js({"configuration":{"statuses":{"max_characters":500}}})
    if path == "/api/v1/timelines/home": return js([])
    if path == "/api/v1/statuses": posted.append(json.loads(request.post_data)); return js({"id":"99"})
    return js({"error":"x"}, 404)

FAKE_VV = """
(() => {
  const t = new EventTarget();
  const vv = Object.assign(t, { offsetTop: 0, height: window.innerHeight, width: window.innerWidth });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  window.__vv = vv;
})();
"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--no-sandbox"])
    ctx = b.new_context(bypass_csp=True, viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme="light")
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(FAKE_VV)
    page.route(HOST+"/**", handle)
    page.goto(BASE); page.click("#login-form button.ro-botao--principal"); page.wait_for_selector("#fab")
    page.wait_for_timeout(300)
    page.click("#fab"); page.wait_for_selector("#composer[open]")
    r=page.evaluate("""()=>{const out=[];
      for (const sel of ['#view','#composer','#text']) {
        const el=document.querySelector(sel);
        const ev=new Event('touchmove',{bubbles:true,cancelable:true}); el.dispatchEvent(ev); out.push([sel,ev.defaultPrevented]);}
      return out}""")
    print(r)
    assert r[0][1] and r[1][1] and not r[2][1] is None
    page.click("#cancel-compose"); page.wait_for_timeout(100)
    ev=page.evaluate("()=>{const ev=new Event('touchmove',{bubbles:true,cancelable:true});document.querySelector('#view').dispatchEvent(ev);return ev.defaultPrevented}")
    assert ev is False, "fechado não bloqueia"
    print("erros:",errs); assert not errs; print("lock: ok"); b.close()
