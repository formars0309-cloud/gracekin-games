#!/usr/bin/env python3
"""대문·게임 분류·방침·캐릭터 안내를 정적 서버에서 화면 크기별로 검수한다."""
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = Path('/tmp/gracekin-logo-shots')
SIZES = [
    (1512, 860), (1440, 900), (1440, 790), (1920, 950), (1920, 1080),
    (2560, 1300), (3440, 1300), (1180, 740), (1024, 1024), (390, 844), (360, 740),
    # 지정 화면에 없는 3:2판과 이미지 전환 경계도 확인한다.
    (1001, 1000), (1200, 800), (1501, 1000),
]


def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    origin = f'http://127.0.0.1:{port}'
    results = []
    try:
        for _ in range(100):
            try:
                with urlopen(origin, timeout=1):
                    break
            except OSError:
                if server.poll() is not None:
                    raise RuntimeError('정적 서버가 시작되지 않았습니다.')
                time.sleep(.05)
        else:
            raise RuntimeError('정적 서버 시작 대기 시간 초과')
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context()
            context.route(re.compile(r'https://[^/]*umami\.(?:is|com)/'), lambda route: route.abort())
            context.route('**/api/account/summary', lambda route: route.fulfill(json={'user': None}))
            for width, height in SIZES:
                page = context.new_page()
                page.set_viewport_size({'width': width, 'height': height})
                paths = [('home', '/')]
                if (width, height) in [(1440, 900), (390, 844), (360, 740)]:
                    paths += [('games', '/games/'), ('privacy', '/privacy/'), ('character', '/character/')]
                for label, path in paths:
                    page.goto(origin + path, wait_until='networkidle')
                    page.evaluate('document.fonts.ready')
                    page.locator('img').evaluate_all('(images) => Promise.all(images.map(image => image.decode()))')
                    metrics = page.evaluate('''() => ({
                        width: innerWidth, height: innerHeight,
                        scrollWidth: document.documentElement.scrollWidth,
                        scrollHeight: document.documentElement.scrollHeight,
                        image: document.querySelector('.gb-backdrop img')?.currentSrc.split('/').pop() ?? null
                    })''')
                    metrics['horizontalOverflow'] = max(0, metrics['scrollWidth'] - width)
                    assert metrics['horizontalOverflow'] == 0, (label, metrics)
                    logos = page.locator('img[alt="Gracekin Games"]')
                    assert logos.count() == 1
                    metrics['logo'] = logos.evaluate('(image) => ({loaded: image.complete && image.naturalWidth > 0, source: image.currentSrc.split("/").pop(), width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height})')
                    assert metrics['logo']['loaded'], (label, metrics)
                    tabs = page.locator('[data-site-tabs] a')
                    assert tabs.all_text_contents() == ['모든 게임', '커뮤니티', '의견 보내기', '로그인']
                    assert [tabs.nth(i).get_attribute('href') for i in range(4)] == [
                        '/games/', 'https://community.gracekingames.com/community/',
                        'https://docs.google.com/forms/d/e/1FAIpQLSezA52mxi13kKNyLORsFTjZGpxHa84rIzh7GVKfOthP6AI16w/viewform', '/account/']
                    assert page.locator('[data-account-header]').get_attribute('data-account-state') == 'guest'
                    assert tabs.nth(3).get_attribute('aria-label') == '그레이스킨게임즈 계정 로그인'
                    assert tabs.nth(3).evaluate('(link) => getComputedStyle(link).backgroundColor') == 'rgb(230, 201, 138)'
                    tab_metrics = tabs.evaluate_all('(links) => links.map(link => {const r = link.getBoundingClientRect(), s = getComputedStyle(link); return {top:r.top, bottom:r.bottom, left:r.left, right:r.right, height:r.height, fontSize:s.fontSize}})')
                    assert len({tab['top'] for tab in tab_metrics}) == 1, (label, tab_metrics)
                    assert len({tab['height'] for tab in tab_metrics}) == 1, (label, tab_metrics)
                    assert len({tab['fontSize'] for tab in tab_metrics}) == 1, (label, tab_metrics)
                    gaps = [tab_metrics[i+1]['left'] - tab_metrics[i]['right'] for i in range(3)]
                    assert max(gaps) - min(gaps) < 1, (label, gaps)
                    current = page.locator('[data-site-tabs] [aria-current="page"]')
                    assert current.count() == (1 if label == 'games' else 0)
                    metrics['tabs'] = tab_metrics
                    if width <= 760:
                        assert logos.bounding_box()['y'] + logos.bounding_box()['height'] <= tab_metrics[0]['top'], (label, metrics)
                    if label == 'character':
                        assert page.locator('meta[name="robots"]').get_attribute('content') == 'noindex'
                        assert page.locator('.gb-character-links a').all_text_contents() == ['모든 게임 둘러보기', '커뮤니티 새 소식 보기']
                    if label == 'home':
                        assert metrics['scrollHeight'] <= height, metrics
                        shape = 'tall' if width <= height else 'wide' if width / height <= 1.5 else 'pano'
                        assert f'hero-{shape}-' in metrics['image'], metrics
                        artwork = page.locator('.gb-backdrop img').evaluate('''async image => {
                            // naturalWidth는 srcset 밀도로 보정되므로 실제 파일의 종횡비를 쓴다.
                            const bitmap = await createImageBitmap(await (await fetch(image.currentSrc)).blob());
                            const sourceWidth = bitmap.width, sourceHeight = bitmap.height;
                            bitmap.close();
                            const rect = image.getBoundingClientRect(), style = getComputedStyle(image);
                            const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight);
                            const displayedHeight = sourceHeight * scale;
                            const positionY = parseFloat(style.objectPosition.split(' ')[1]) / 100;
                            const top = rect.top + (rect.height - displayedHeight) * positionY;
                            const bottom = top + displayedHeight;
                            return {
                                sourceWidth, sourceHeight, displayedHeight, top, bottom,
                                cropTop: Math.max(0, -top), cropBottom: Math.max(0, bottom - innerHeight),
                                verticalFits: displayedHeight <= innerHeight + 1,
                                bottomVisible: bottom <= innerHeight + 1,
                                objectFit: style.objectFit, objectPosition: style.objectPosition
                            };
                        }''')
                        assert artwork['objectFit'] == 'cover', artwork
                        assert artwork['objectPosition'] == ('50% 30%' if shape == 'pano' else '50% 50%'), artwork
                        if shape != 'tall' and (width, height) != (3440, 1300):
                            assert artwork['verticalFits'] and artwork['bottomVisible'], artwork
                        metrics['artwork'] = artwork
                        metrics['horizontalOverflow'] = max(0, metrics['scrollWidth'] - width)
                        metrics['verticalScroll'] = max(0, metrics['scrollHeight'] - height)
                        assert page.locator('#games, .gb-game').count() == 0
                        assert page.locator('h1').inner_text().replace('\n', ' ').split() == ['모험의', '세계로,', '함께', '떠나요.']
                        button = page.locator('[data-umami-event="hero-character"]')
                        assert button.get_attribute('href') == '/character/'
                        assert button.inner_text() == '캐릭터 생성 게임으로 시작하기'
                        assert page.locator('[data-umami-event="hero-games"], [data-umami-event="hero-community"], .gb-hero-subtitle, .gb-hero-brand').count() == 0
                        assert (240 <= metrics['logo']['width'] <= 280) if width <= 760 else (420 <= metrics['logo']['width'] <= 480)
                        assert button.bounding_box()['height'] >= 50
                        layout = page.evaluate('''() => {
                            const rect = selector => document.querySelector(selector).getBoundingClientRect();
                            const nav = rect('.gb-nav'), copy = rect('.gb-hero-copy'), foot = rect('.gb-legal'), title = rect('h1');
                            return {navBottom: nav.bottom, copyTop: copy.top, copyBottom: copy.bottom, footerTop: foot.top, titleTop: title.top};
                        }''')
                        assert layout['navBottom'] <= (layout['titleTop'] if width <= 760 else layout['copyTop']), layout
                        assert layout['copyBottom'] <= layout['footerTop'], layout
                        metrics['layout'] = layout
                    page.screenshot(path=str(OUTPUT / f'{label}-{width}x{height}.png'), full_page=True)
                    results.append({'page': label, **metrics})
                    print(f'화면 확인: {label} {width}×{height}', flush=True)
                    if label == 'games':
                        for category, expected in [('puzzle', ['puzzle']), ('card', ['card']), ('board', [])]:
                            page.locator(f'[data-filter="{category}"]').click()
                            assert page.locator('.gb-game:visible').evaluate_all('(cards) => cards.map(card => card.dataset.genre)') == expected
                            assert page.locator('#board-empty').is_visible() == (category == 'board')
                            assert page.locator(f'[data-filter="{category}"]').get_attribute('aria-pressed') == 'true'
                            assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
                            page.screenshot(path=str(OUTPUT / f'games-{category}-{width}x{height}.png'), full_page=True)
                        page.reload(wait_until='networkidle')
                        assert page.locator('#board-empty').is_visible()
                        page.locator('[data-filter="board"]').focus()
                        page.keyboard.press('ArrowLeft')
                        assert page.locator('[data-filter="card"]').evaluate('(button) => button === document.activeElement')
                        assert page.locator('.gb-game:visible').count() == 1
                        page.keyboard.press('Home')
                        assert page.locator('.gb-game:visible').count() == 2
                        page.go_back(wait_until='networkidle')
                        assert page.locator('[data-filter="card"]').get_attribute('aria-pressed') == 'true'
                page.close()
            context.close()
            for width, height in [(1440, 900), (390, 844), (360, 740)]:
                context = browser.new_context(viewport={'width': width, 'height': height})
                context.route(re.compile(r'https://[^/]*umami\.(?:is|com)/'), lambda route: route.abort())
                state = {'error': False, 'balance': 30300}
                def summary(route):
                    route.fulfill(status=503 if state['error'] else 200, json={'user': {'name': '긴이름의모험가' * 4, 'grainBalance': state['balance']}})
                context.route('**/api/account/summary', summary)
                page = context.new_page()
                for label, path in [('home', '/'), ('games', '/games/'), ('privacy', '/privacy/'), ('character', '/character/')]:
                    state['error'] = False
                    page.goto(origin + path, wait_until='networkidle')
                    assert page.locator('[data-account-label]').inner_text() == '내 계정'
                    assert page.locator('[data-account-grain]').is_visible()
                    assert page.locator('[data-account-balance]').inner_text() == '30,300 코인'
                    assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
                    assert page.locator('[data-account-link]').get_attribute('aria-label') == f'{"긴이름의모험가" * 4}님, 30,300 그레이스킨 코인, 내 계정 열기'
                    account_layout = page.locator('[data-account-link]').evaluate('''link => {
                        const label = link.querySelector('[data-account-label]').getBoundingClientRect();
                        const coin = link.querySelector('[data-account-grain]').getBoundingClientRect();
                        const amount = link.querySelector('[data-account-balance]');
                        return {sameLine: Math.abs(label.top + label.height / 2 - coin.top - coin.height / 2) < 1,
                                beside: label.right <= coin.left, amountFits: amount.scrollWidth <= amount.clientWidth + 1};
                    }''')
                    assert all(account_layout.values()), (width, label, account_layout)
                    tab_tops = page.locator('[data-site-tabs] a').evaluate_all('(links) => links.map(link => link.getBoundingClientRect().top)')
                    assert len(set(tab_tops)) == 1, (width, label, tab_tops)
                    if label == 'home':
                        assert page.evaluate('document.documentElement.scrollHeight <= innerHeight')
                    page.screenshot(path=str(OUTPUT / f'{label}-signed-in-{width}x{height}.png'), full_page=True)
                    state['error'] = True
                    page.reload(wait_until='networkidle')
                    assert page.locator('[data-account-retry]').is_visible()
                    assert page.locator('[data-account-label]').inner_text() == '내 계정'
                    assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
                    page.screenshot(path=str(OUTPUT / f'{label}-retry-{width}x{height}.png'), full_page=True)
                    state['error'] = False
                    page.locator('[data-account-retry]').click()
                    page.wait_for_function('!document.querySelector("[data-account-grain]").hidden')
                    assert page.locator('[data-account-label]').inner_text() == '내 계정'
                    assert not page.locator('[data-account-retry]').is_visible()
                state['balance'] = 9007199254740991
                page.goto(origin + '/', wait_until='networkidle')
                assert page.locator('[data-account-balance]').inner_text() == '9,007,199,254,740,991 코인'
                assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
                assert '9,007,199,254,740,991 그레이스킨 코인' in page.locator('[data-account-link]').get_attribute('aria-label')
                page.screenshot(path=str(OUTPUT / f'home-large-balance-{width}x{height}.png'), full_page=True)
                print(f'계정 상태 확인: {width}×{height}', flush=True)
                context.close()
            context = browser.new_context(java_script_enabled=False)
            page = context.new_page()
            page.goto(origin + '/games/#board')
            assert page.locator('.gb-game:visible').count() == 2
            context.close()
            browser.close()
        (OUTPUT / 'measurements.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'측정': results, '탭·키보드·해시·뒤로가기·JS없는목록': '통과', '캡처': str(OUTPUT)}, ensure_ascii=False, indent=2))
    finally:
        if server.poll() is None:
            os.kill(server.pid, signal.SIGTERM)
        server.wait(timeout=5)


if __name__ == '__main__':
    run()
