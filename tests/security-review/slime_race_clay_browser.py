#!/usr/bin/env python3
"""격리 서버에서 점토 자산·지연/실패 복구·DPR·모바일 터치를 검수한다."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CLAY = ('backdrop.webp', 'lane.webp', 'title-plaque.png', 'panel.png', 'button.png', 'button-gold.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    output = args.output_dir or Path(tempfile.mkdtemp(prefix='race-clay-review-'))
    output.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen(['node', str(ROOT / 'tests/security-review/slime-race-fixture.mjs')], cwd=ROOT,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, env={**os.environ, 'NODE_ENV': 'test'})
    checks, evidence = [], {}

    def receive():
        line = process.stdout.readline()
        if not line:
            raise RuntimeError('격리 서버 응답 없음: ' + process.stderr.read())
        return json.loads(line)

    def command(action):
        process.stdin.write(json.dumps({'action': action}) + '\n')
        process.stdin.flush()
        return receive()

    def snapshot(page, name):
        return page.locator('.sr-arena').screenshot(path=str(output / f'{name}.png'))

    try:
        fixture = receive()
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            for mode in ('loaded', 'delayed', 'failed'):
                context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
                context.add_init_script('''window.__reviewImages=[]; const OriginalImage=window.Image;
                  window.Image=function(...args) {const img=new OriginalImage(...args); window.__reviewImages.push(img); return img;};
                  window.Image.prototype=OriginalImage.prototype;''')
                held, errors, responses = [], [], []

                def route_request(route):
                    request = route.request
                    local = urlsplit(request.url).hostname == '127.0.0.1'
                    clay = urlsplit(request.url).path.rsplit('/', 1)[-1] in CLAY
                    # 이 스크립트에는 쓰기 동작이 없다. 로컬을 포함한 모든 POST도 차단한다.
                    if not local or request.method not in ('GET', 'HEAD'):
                        route.abort()
                    elif clay and mode == 'failed':
                        route.abort()
                    elif clay and mode == 'delayed':
                        held.append(route)
                    else:
                        route.continue_()

                context.route('**/*', route_request)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('response', lambda response: responses.append((response.url, response.status)))
                page.goto(fixture['origin'], wait_until='domcontentloaded')
                page.locator('[data-announcer-message]').filter(has_text='응원할 친구').wait_for()
                if mode == 'delayed':
                    page.wait_for_function('window.__reviewImages.length >= 6')
                    assert len(held) >= len(CLAY), '지연 주입 자산 요청 누락'
                    before = snapshot(page, 'delayed-before')
                    page.locator('[data-action="ticket"]').click()
                    page.locator('#sr-ticket').wait_for(state='visible')
                    page.keyboard.press('Escape')
                    for route in held:
                        route.continue_()
                    held.clear()
                page.wait_for_load_state('networkidle')
                page.wait_for_function('window.__reviewImages.every(img => img.complete)')
                if mode != 'failed':
                    loaded = page.evaluate('''() => window.__reviewImages.map(img=>({url:img.src,width:img.naturalWidth,height:img.naturalHeight,loaded:img.complete&&img.naturalWidth>0}))''')
                    for filename in CLAY:
                        match = [item for item in loaded if urlsplit(item['url']).path.endswith('/' + filename)]
                        assert match and match[0]['loaded'], '점토 자산 로드 실패: ' + filename
                        assert any(urlsplit(url).path.endswith('/' + filename) and status == 200 for url, status in responses), '점토 자산 HTTP200 없음: ' + filename
                    evidence[mode + '_images'] = loaded
                    assert page.locator('.sr-announcer img').evaluate('(img)=>img.complete && img.naturalWidth>0'), '부엉이 로드 실패'
                    page.wait_for_function("document.querySelector('#slime-race').classList.contains('sr-art-plaque')")
                    after = snapshot(page, mode + '-desktop')
                    if mode == 'delayed':
                        assert hashlib.sha256(before).digest() != hashlib.sha256(after).digest(), '지연 자산 로드 후 장면 갱신 없음'
                        checks.append('점토 자산 응답을 지연해도 티켓 사용 가능·완료 후 그림 캐시가 갱신됨')
                    else:
                        checks.append('모든 점토 자산·부엉이 HTTP200 및 실제 이미지 디코드 완료')
                        versions = page.evaluate('''() => ({css:document.querySelector('link[href*="race.css"]').href,js:document.querySelector('script[src*="race.js"]').src})''')
                        assert all('20261018-clay' in url for url in versions.values()), '새 CSS/JS 캐시 버전 누락'
                        evidence['캐시 버전'] = versions
                        fonts = [(url,status) for url,status in responses if urlsplit(url).path.endswith('.woff2')]
                        assert fonts and all(status == 200 for _,status in fonts), '로컬 woff2 폰트 HTTP200 누락'
                        await_fonts = page.evaluate('''async () => {await document.fonts.ready; return [...document.fonts].map(font=>({family:font.family,status:font.status}));}''')
                        assert any(font['status']=='loaded' and 'Jua' in font['family'] for font in await_fonts), 'Jua 폰트 디코드/적용 누락'
                        evidence['폰트'] = await_fonts
                        # JS에서만 쓰는 그림도 원격 빌드 허용목록의 파일·상위 폴더를 확인한다.
                        allowed = {line.strip()[1:] for line in (ROOT/'.dockerignore').read_text().splitlines() if line.strip().startswith('!')}
                        paths = [urlsplit(url).path.lstrip('/') for url,_ in responses if urlsplit(url).path.rsplit('/',1)[-1] in CLAY or urlsplit(url).path.endswith('.woff2')]
                        for resource in paths:
                            path = Path(resource)
                            assert resource in allowed and all(parent.as_posix()+'/' in allowed for parent in path.parents if parent!=Path('.')), '원격 이미지 허용목록 누락: '+resource
                        evidence['운영 패키지 포함 자산'] = sorted(set(paths))
                        checks.append('로컬 Jua woff2 HTTP200·폰트 디코드 및 JS 전용 그림을 포함한 원격 빌드 허용목록 확인')
                        # 같은 정지 상태로 돌아왔을 때 스크린샷이 일치해야 예전 크기 캐시가 남지 않는다.
                        page.set_viewport_size({'width': 390, 'height': 844})
                        page.wait_for_timeout(120)
                        small_before = snapshot(page, 'loaded-mobile-390')
                        page.set_viewport_size({'width': 1024, 'height': 1000})
                        page.wait_for_timeout(120)
                        page.set_viewport_size({'width': 390, 'height': 844})
                        page.wait_for_timeout(120)
                        small_after = snapshot(page, 'loaded-mobile-390-resized')
                        assert small_before == small_after, '왕복 resize 뒤 경기장 캐시/장면이 달라짐'
                        checks.append('390→1024→390px 왕복 resize에서 정지 장면 동일·CSS/JS 캐시 버전 갱신')
                else:
                    assert not page.locator('#slime-race').evaluate("el=>['sr-art-plaque','sr-art-panel','sr-art-button','sr-art-gold'].some(c=>el.classList.contains(c))"), '실패 자산을 성공 클래스로 표시'
                    snapshot(page, 'failed-desktop')
                    checks.append('새 점토 자산 전체 요청 실패에도 대체 경기장 표시·사회자/구매창 사용 가능')
                page.locator('[data-action="ticket"]').click()
                page.locator('#sr-ticket').wait_for(state='visible')
                assert page.locator('[data-action="buy"]').is_disabled(), '게스트 구매 잠금 누락'
                page.keyboard.press('Escape')
                page.locator('#sr-ticket').wait_for(state='hidden')
                assert not errors, f'{mode}: 브라우저 실행 오류 {errors}'
                context.close()

            # 고해상도 모바일의 실제 터치와 확대 후에도 구매창 접근·닫기가 된다.
            for width in (320, 390):
                context = browser.new_context(viewport={'width': width, 'height': 844}, device_scale_factor=2,
                                              is_mobile=True, has_touch=True, reduced_motion='reduce')
                def local_only(route):
                    if urlsplit(route.request.url).hostname != '127.0.0.1' or route.request.method not in ('GET', 'HEAD'):
                        route.abort()
                    else:
                        route.continue_()
                context.route('**/*', local_only)
                page = context.new_page()
                page.goto(fixture['origin'], wait_until='networkidle')
                page.locator('[data-announcer-message]').filter(has_text='응원할 친구').wait_for()
                dpr = page.locator('.sr-arena canvas').evaluate('(c)=>({width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight})')
                assert dpr['width'] == round(dpr['cssWidth'] * 2) and dpr['height'] == round(dpr['cssHeight'] * 2), 'DPR2 캔버스 해상도 불일치'
                snapshot(page, f'touch-dpr2-{width}')
                page.locator('[data-action="ticket"]').tap()
                page.locator('#sr-ticket').wait_for(state='visible')
                page.locator('[data-action="close"]').tap()
                page.locator('#sr-ticket').wait_for(state='hidden')
                session = context.new_cdp_session(page)
                session.send('Emulation.setPageScaleFactor', {'pageScaleFactor': 2})
                assert page.evaluate('visualViewport.scale') == 2, '확대 적용 실패'
                def zoomed_tap(selector):
                    element=page.locator(selector)
                    element.scroll_into_view_if_needed()
                    # CDP의 2배 핀치 확대에서 Playwright locator.tap은 layout 좌표를
                    # 그대로 보내므로 다른 요소를 누른다. visualViewport 오프셋을 뺀 화면 좌표로 터치를 보낸다.
                    point=element.evaluate("el=>{const r=el.getBoundingClientRect(),v=visualViewport;return {x:r.x+r.width/2-v.offsetLeft,y:r.y+r.height/2-v.offsetTop};}")
                    session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]})
                    session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                zoomed_tap('[data-action="ticket"]')
                page.locator('#sr-ticket').wait_for(state='visible',timeout=5000)
                zoomed_tap('[data-action="close"]')
                page.locator('#sr-ticket').wait_for(state='hidden',timeout=5000)
                context.close()
            checks.append('320/390px DPR2 캔버스 실제 해상도·터치·2배 확대 후 구매창 열기/닫기')
            browser.close()
        report = {'통과': checks, '증빙': str(output), '관측': evidence, '운영 요청': '외부 요청 및 모든 POST 차단·실제 회원 미사용'}
        (output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps({'통과': checks, '증빙': str(output)}, ensure_ascii=False, indent=2))
    finally:
        if process.poll() is None:
            try:
                command('close')
                process.wait(timeout=15)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                process.terminate()
                process.wait(timeout=5)


if __name__ == '__main__':
    main()
