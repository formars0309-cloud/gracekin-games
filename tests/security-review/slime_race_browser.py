#!/usr/bin/env python3
"""실제 격리 서버에서 홈 티켓 흐름·모바일·소리·감소 모션을 검수한다."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    output = args.output_dir or Path(tempfile.mkdtemp(prefix='gracekin-race-review-'))
    output.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen(
        ['node', str(ROOT / 'tests/security-review/slime-race-fixture.mjs')],
        cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, env={**os.environ, 'NODE_ENV': 'test'},
    )

    def receive():
        line = process.stdout.readline()
        if not line:
            raise RuntimeError('격리 서버가 응답하지 않습니다: ' + process.stderr.read())
        return json.loads(line)

    def command(action, **values):
        process.stdin.write(json.dumps({'action': action, **values}) + '\n')
        process.stdin.flush()
        return receive()

    checks = []
    try:
        fixture = receive()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
            context.add_cookies([
                {'name': item.split('=', 1)[0], 'value': item.split('=', 1)[1], 'url': fixture['origin']}
                for item in fixture['cookie'].split('; ')
            ])
            # 검수에서 실제 운영 서버·통계·폰트 서비스에 요청하지 않는다.
            context.route('**/*', lambda route: route.continue_() if urlsplit(route.request.url).hostname == '127.0.0.1' else route.abort())
            page = context.new_page()
            errors = []
            audio_requests = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: audio_requests.append(request.url) if request.url.endswith('.mp3') else None)
            page.goto(fixture['origin'], wait_until='networkidle')
            assert page.locator('[data-action="sound"]').get_attribute('aria-pressed') == 'false', '첫 진입 무음 위반'
            assert not audio_requests, '사용자 소리 선택 전 음원 요청 발생'
            with page.expect_response(lambda response: response.url.endswith('/assets/slime-race/bgm-spring.mp3')) as music:
                page.locator('[data-action="sound"]').click()
            assert music.value.status == 200, '소리 선택 뒤 음원 요청 실패'
            assert page.locator('[data-action="sound"]').get_attribute('aria-pressed') == 'true'
            page.locator('[data-action="sound"]').click()
            assert page.locator('[data-action="sound"]').get_attribute('aria-pressed') == 'false'
            page.locator('[data-action="ticket"]').click()
            page.locator('.sr-runner').nth(4).wait_for()
            assert page.locator('[data-action="buy"]').is_disabled(), '성인 미확인 구매가 열림'
            assert page.locator('[data-action="sound"]').get_attribute('aria-pressed') == 'false', '첫 진입 무음 위반'
            checks.append('로그인한 14plus도 성인 미확인 구매 차단·첫 무음·소리 선택 뒤만 음원 요청과 재생 토글')

            command('adult', value=True)
            page.locator('[data-action="refresh-me"]').click()
            page.locator('[data-action="buy"]').wait_for(state='visible')
            page.wait_for_function("!document.querySelector('[data-action=buy]').disabled")
            page.screenshot(path=str(output / 'desktop-dialog.png'), full_page=True)

            def buy(index, amount):
                page.locator('.sr-runner').nth(index).click()
                page.locator('[data-amount]').fill(str(amount))
                with page.expect_response(lambda response: response.url.endswith('/api/slime-race/tickets') and response.request.method == 'POST') as reply:
                    page.locator('[data-action="buy"]').click()
                assert reply.value.status == 200, '화면 티켓 구매·수정 실패'
                page.wait_for_function("!document.querySelector('[data-action=buy]').disabled")

            buy(0, 1000)
            assert command('ledger')['me']['wallet']['balance'] == 29000
            buy(0, 1500)
            assert command('ledger')['me']['wallet']['balance'] == 28500
            buy(1, 500)
            assert command('ledger')['me']['wallet']['balance'] == 28000
            with page.expect_response(lambda response: response.url.endswith('/api/slime-race/tickets') and response.request.method == 'POST') as reply:
                page.locator('[data-action="cancel"]').click()
            assert reply.value.status == 200, '화면 티켓 취소 실패'
            assert command('ledger')['me']['wallet']['balance'] == 28500
            for index in range(1, 5):
                buy(index, 100)
            before = command('ledger')
            assert len(before['me']['bets']) == 5 and before['me']['wallet']['balance'] == 28100
            checks.append('화면에서 구매·총액 수정·분산 구매·취소 후 공용 지갑과 원장 일치')

            page.keyboard.press('Escape')
            page.locator('#sr-ticket').wait_for(state='hidden')
            assert page.locator('[data-action="ticket"]').evaluate('(el) => document.activeElement === el'), '창 닫기 초점 복귀 실패'
            page.screenshot(path=str(output / 'desktop-home.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            page.locator('[data-action="ticket"]').click()
            page.locator('#sr-ticket').wait_for(state='visible')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), '모바일 가로 넘침'
            details = page.locator('.sr-runner-detail').first.evaluate('(el) => ({display:getComputedStyle(el).display, columns:getComputedStyle(el).gridTemplateColumns.split(" ").length})')
            assert details['display'] == 'grid' and details['columns'] == 3, '모바일 선수 정보 세 열 누락'
            assert page.locator('#sr-ticket').bounding_box()['y'] >= 0, '모바일 시트 상단 넘침'
            page.screenshot(path=str(output / 'mobile-dialog.png'), full_page=True)
            checks.append('PC 팝업·390px 모바일 시트·세 열 정보·Escape 초점 복귀·감소 모션 환경')

            command('time', elapsed=500000)
            page.reload(wait_until='networkidle')
            page.locator('[data-action="ticket"]').click()
            page.locator('.sr-runner').nth(4).wait_for()
            assert page.locator('[data-action="buy"]').is_disabled(), '마감 뒤 구매 버튼 열림'
            locked = command('ledger')
            assert locked['state']['round']['phase'] == 'countdown'
            assert 'winnerId' not in locked['state']['round']
            command('time', elapsed=510000)
            page.reload(wait_until='networkidle')
            assert command('ledger')['state']['round']['phase'] == 'racing'
            checks.append('500초 마감·510초 경주·결과 전 승자 필드 비노출')

            final = command('time', elapsed=570000)
            page.reload(wait_until='networkidle')
            page.locator('[data-result-winner]').wait_for(state='visible')
            winner = next(item for item in final['state']['round']['entrants'] if item['slimeId'] == final['state']['round']['winnerId'])
            assert winner['name'] in page.locator('[data-result-winner]').inner_text(), '화면 우승자와 서버 불일치'
            bet = next(item for item in before['me']['bets'] if item['slimeId'] == winner['slimeId'])
            payout = bet['amount'] * bet['oddsCents'] // 100
            assert final['me']['wallet']['balance'] == 28100 + payout
            assert sum(item['amount'] for item in final['ledger']) == final['me']['wallet']['balance']
            assert len([item for item in final['ledger'] if item['eventId'].startswith('slime-race:payout:')]) == 1
            assert command('ledger')['me']['wallet'] == final['me']['wallet'], '결과 재조회 중복 정산'
            page.screenshot(path=str(output / 'mobile-result.png'), full_page=True)
            checks.append('570초 서버 승자와 결과 화면 일치·정수 배당 지급·재조회 중복 정산 없음')
            assert not errors, '브라우저 실행 오류: ' + '; '.join(errors)
            context.close()
            browser.close()
        report = {'통과': checks, '스크린샷': str(output), '운영 요청': '로컬 127.0.0.1 이외 전부 차단'}
        (output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        if process.poll() is None:
            try:
                command('close')
                process.wait(timeout=10)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                process.terminate()
                process.wait(timeout=10)


if __name__ == '__main__':
    main()
