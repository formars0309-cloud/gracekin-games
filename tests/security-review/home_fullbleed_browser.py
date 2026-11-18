#!/usr/bin/env python3
"""대문·게임 분류·방침 안내를 정적 서버에서 화면 크기별로 검수한다."""
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
OUTPUT = Path('/tmp/gracekin-fullbleed-shots')
SIZES = [(1920, 1080), (1440, 900), (390, 844), (360, 740)]


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
            for width, height in SIZES:
                context = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=2 if width < 700 else 1)
                context.route(re.compile(r'https://[^/]*umami\.(?:is|com)/'), lambda route: route.abort())
                page = context.new_page()
                for label, path in [('home', '/'), ('games', '/games/'), ('privacy', '/privacy/')]:
                    page.goto(origin + path, wait_until='networkidle')
                    page.evaluate('document.fonts.ready')
                    page.locator('img').evaluate_all('(images) => Promise.all(images.map(image => image.decode()))')
                    metrics = page.evaluate('''() => ({
                        width: innerWidth, height: innerHeight,
                        scrollWidth: document.documentElement.scrollWidth,
                        scrollHeight: document.documentElement.scrollHeight,
                        image: document.querySelector('.gb-backdrop img')?.currentSrc.split('/').pop() ?? null
                    })''')
                    assert metrics['scrollWidth'] == width, (label, metrics)
                    if label == 'home':
                        assert metrics['scrollHeight'] <= height, metrics
                        assert ('tall' if width <= height else 'wide') in metrics['image'], metrics
                        assert page.locator('#games, .gb-game').count() == 0
                        assert page.locator('[data-umami-event="hero-games"]').get_attribute('href') == '/games/'
                        layout = page.evaluate('''() => {
                            const rect = selector => document.querySelector(selector).getBoundingClientRect();
                            const nav = rect('.gb-nav'), copy = rect('.gb-hero-copy'), foot = rect('.gb-legal');
                            return {navBottom: nav.bottom, copyTop: copy.top, copyBottom: copy.bottom, footerTop: foot.top};
                        }''')
                        assert layout['navBottom'] <= layout['copyTop'] < layout['copyBottom'] <= layout['footerTop'], layout
                        metrics['layout'] = layout
                    page.screenshot(path=str(OUTPUT / f'{label}-{width}x{height}.png'), full_page=True)
                    results.append({'page': label, **metrics})
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
