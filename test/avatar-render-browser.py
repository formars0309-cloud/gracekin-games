"""독립 표본으로 조형·회전·보행·접근성·대체 화면을 검수하고 지정한 폴더에 캡처를 남긴다."""
import argparse
import functools
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = [
    ("guardian", "수호기사", 0, "#c59576", "#4b302c", "#5e9faa", "#436677"),
    ("ranger", "숲길잡이", 1, "#ad7559", "#613b29", "#698859", "#65754e"),
    ("arcanist", "룬술사", 2, "#d59d80", "#3e3557", "#6a919e", "#675784"),
    ("healer", "별빛치유사", 3, "#a4745e", "#513a42", "#80906c", "#577c7f"),
]
HTML = """<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport"
content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;background:#262b34;color:#eadfc9;font:16px system-ui}
main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2px}
article{background:radial-gradient(ellipse at 43% 36%,#535866,#343944 78%);text-align:center}
.figure{height:430px}h2{font-size:15px;font-weight:500;margin:0;padding:0 0 16px}
@media(max-width:480px){main{grid-template-columns:1fr}.figure{height:420px}}
</style><main></main><script type="module">
import {createAvatarView} from '/assets/avatar/renderer.js';
window.build=(samples,mode='studio')=>{
 window.views?.forEach(v=>v.dispose());window.views=[];window.heroes=[];
 document.querySelector('main').replaceChildren();
 for(const [job,name,hairStyle,skinColor,hairColor,eyeColor,clothColor] of samples){
  const appearance={height:50,build:50,shoulders:50,jaw:50,eyes:50,nose:50,hairStyle,skinColor,hairColor,eyeColor,clothColor};
  const character={name,appearance,job,recommendedJob:null};window.heroes.push(character);
  const row=document.createElement('article'),slot=document.createElement('div'),title=document.createElement('h2');
  title.textContent=name;slot.className='figure';row.append(slot,title);document.querySelector('main').append(row);
  window.views.push(createAvatarView(slot,character,{mode}));
 }
};window.ready=true;</script></html>"""


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/":
            data = HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(data)
        elif self.path.startswith("/assets/avatar/") and ".." not in self.path:
            super().do_GET()
        else:
            self.send_error(404)


def run(out, webkit):
    out.mkdir(exist_ok=True, parents=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            page = browser.new_page(viewport={"width": 1280, "height": 470}, reduced_motion="reduce")
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            address = f"http://127.0.0.1:{server.server_port}/"
            page.goto(address)
            page.wait_for_function("window.ready")
            page.evaluate("samples=>build(samples)", SAMPLES)
            canvas = page.locator("canvas").first
            page.wait_for_function("document.querySelector('canvas').width!==300")
            assert canvas.evaluate("c=>Boolean(c.getContext('webgl'))"), "그래픽 가속 경로 확인 실패"

            def capture(name):
                page.evaluate("()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
                page.locator("main").screenshot(path=str(out / (name + ".png")))

            capture("01-직업별-전신")
            page.evaluate("views.forEach(v=>v.setView('face'))")
            capture("02-직업별-얼굴")
            before = canvas.screenshot()
            page.wait_for_timeout(180)
            assert before == canvas.screenshot(), "움직임 줄이기 설정 실패"
            page.locator("[tabindex]").first.focus()
            page.keyboard.press("ArrowRight")
            assert before != canvas.screenshot(), "방향키 회전 실패"
            page.evaluate("views.forEach(v=>{v.setView('full');v.rotate(Math.PI+.35)})")
            capture("03-후면")
            page.evaluate("samples=>build(samples,'board')", SAMPLES)
            capture("04-게임말")
            page.evaluate("samples=>build(samples,'portrait')", SAMPLES)
            capture("05-초상화")
            page.set_viewport_size({"width": 390, "height": 600})
            page.evaluate("samples=>build(samples.slice(0,1),'rpg')", SAMPLES)
            page.emulate_media(reduced_motion="no-preference")
            page.evaluate("views[0].setMotion('walk')")
            capture("06-모바일-보행")
            before = canvas.screenshot()
            page.wait_for_timeout(210)
            assert before != canvas.screenshot(), "보행 자세 갱신 실패"
            page.emulate_media(reduced_motion="reduce")
            page.evaluate("""()=>{const h=heroes[0];views[0].update({...h,name:'새 얼굴',recommendedJob:'healer',
              appearance:{...h.appearance,jaw:100,eyes:100,nose:100,build:100,height:100,
              shoulders:100,skinColor:'#876454',hairStyle:1,clothColor:'#877394'}})}""")
            assert "새 얼굴" in page.get_by_role("img").get_attribute("aria-label")
            assert "추천 직업은 별빛치유사" in page.get_by_role("img").get_attribute("aria-label")
            capture("07-체형-갱신")
            page.evaluate("document.querySelector('canvas').getContext('webgl').getExtension('WEBGL_lose_context').loseContext()")
            page.wait_for_function("document.querySelector('canvas').getContext('2d')!==null")
            capture("08-가속-손실")
            page.evaluate("views[0].dispose();views[0].dispose()")
            assert page.locator("canvas").count() == 0
            page.add_init_script("""const get=HTMLCanvasElement.prototype.getContext;
              HTMLCanvasElement.prototype.getContext=function(type,...args){
                return type==='webgl'?null:get.call(this,type,...args)}""")
            page.goto(address)
            page.wait_for_function("window.ready")
            page.evaluate("samples=>build(samples.slice(1,2),'studio')", SAMPLES)
            capture("09-가속-미지원")
            assert canvas.evaluate("c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)")
            page.evaluate("""async()=>{const {createAvatarView}=await import('/assets/avatar/renderer.js');
                const slot=document.querySelector('.figure'),old=views[0];
                const kept=document.createElement('span');kept.className='kept';slot.append(kept);
                views[0]=createAvatarView(slot,heroes[0],{mode:'portrait'});old.dispose()}""")
            assert page.locator("canvas").count() == 1 and page.locator(".kept").count() == 1
            assert "얼굴" in page.get_by_role("img").get_attribute("aria-label")
            assert not errors, errors
            browser.close()
            if webkit:
                browser = pw.webkit.launch()
                phone = browser.new_page(**pw.devices["iPhone 13"], reduced_motion="reduce")
                phone.on("pageerror", lambda error: errors.append(str(error)))
                phone.goto(address)
                phone.wait_for_function("window.ready")
                phone.evaluate("samples=>build(samples.slice(0,1),'studio')", SAMPLES)
                phone.wait_for_function("document.querySelector('canvas').width!==300")
                assert phone.locator("canvas").evaluate("c=>Boolean(c.getContext('webgl'))")
                phone.locator("main").screenshot(path=str(out / "10-모바일-웹킷.png"))
                assert not errors, errors
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--webkit", action="store_true", help="아이폰 크기의 웹킷에서도 확인한다")
    args = parser.parse_args()
    run(args.output, args.webkit)
