import os

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None,args=["--no-sandbox"])
    ctx=b.new_context(bypass_csp=True,); pg=ctx.new_page()
    pg.goto("http://localhost:8765/"); pg.wait_for_function("navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(()=>true)")
    pg.reload(); pg.wait_for_timeout(1500)
    assert pg.evaluate("!!navigator.serviceWorker.controller"), "o service worker deve controlar a página"
    ctx.set_offline(True); pg.reload(); pg.wait_for_selector("#login")
    assert pg.evaluate("!!document.querySelector('#login')"), "offline deve abrir o app"
    b.close()
