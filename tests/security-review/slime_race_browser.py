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
    parser.add_argument('--sound-only', action='store_true', help='음원 취소 보완만 재검수한다')
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
            context.add_init_script("""window.__raceAudioPlays = [];
              const originalPlay = HTMLMediaElement.prototype.play;
              HTMLMediaElement.prototype.play = function() {
                const entry = {src:this.src, status:'pending'};
                window.__raceAudioPlays.push(entry);
                const result = originalPlay.call(this);
                result.then(() => {entry.status='fulfilled';}, () => {entry.status='rejected';});
                return result;
              };""")
            context.add_cookies([
                {'name': item.split('=', 1)[0], 'value': item.split('=', 1)[1], 'url': fixture['origin']}
                for item in fixture['cookie'].split('; ')
            ])
            network_control = {'lose_ticket_reply': False, 'committed_status': None, 'initial_api_failures': False}

            def route_request(route):
                # 검수에서 실제 운영 서버·통계·폰트 서비스에 요청하지 않는다.
                if urlsplit(route.request.url).hostname != '127.0.0.1':
                    route.abort()
                elif network_control['initial_api_failures'] and route.request.url.endswith(('/api/slime-race/state', '/api/slime-race/me')):
                    if network_control['initial_api_failures'] == 'network':
                        route.abort()
                    else:
                        route.fulfill(status=500, content_type='application/json', body=json.dumps({'error': {'code': 'REVIEW_FAILURE', 'message': '검수용 일시 연결 실패'}}))
                elif route.request.url.endswith('/api/slime-race/tickets') and network_control['lose_ticket_reply']:
                    # 서버 저장은 성공했으나 응답만 사라진 실제 재전송 경계를 만든다.
                    network_control['lose_ticket_reply'] = False
                    response = route.fetch()
                    network_control['committed_status'] = response.status
                    route.abort()
                else:
                    route.continue_()

            context.route('**/*', route_request)
            errors = []
            for failure_mode in ([] if args.sound_only else ['server', 'network']):
                failure_page = context.new_page()
                failure_page.on('pageerror', lambda error: errors.append(str(error)))
                network_control['initial_api_failures'] = failure_mode
                failure_page.goto(fixture['origin'], wait_until='networkidle')
                failure_page.locator('[data-public-error]').wait_for(state='visible')
                failure_page.locator('[data-action="ticket"]').click()
                failure_page.wait_for_function("document.querySelector('[data-gate]').textContent.includes('불러오지') || document.querySelector('[data-gate]').textContent.includes('다시')")
                assert not errors, '최초 API 실패에서 브라우저 실행 오류: ' + '; '.join(errors)
                failure_page.screenshot(path=str(output / f'initial-api-{failure_mode}-failure.png'), full_page=True)
                network_control['initial_api_failures'] = False
                failure_page.locator('[data-action="close"]').click()
                failure_page.locator('#sr-ticket').wait_for(state='hidden')
                failure_page.locator('[data-action="retry"]').click()
                failure_page.locator('[data-public-error]').wait_for(state='hidden')
                failure_page.locator('[data-action="ticket"]').click()
                failure_page.locator('.sr-runner').nth(4).wait_for()
                failure_page.wait_for_function("document.querySelector('[data-dialog-balance]').textContent.includes('30,000')")
                assert not errors, 'API 다시 불러오기 복구 중 실행 오류: ' + '; '.join(errors)
                failure_page.close()
            if not args.sound_only:
                checks.append('최초 state·me 500 응답·네트워크 중단에도 실행 오류 없이 안내하고 다시 불러오기로 실제 상태·잔액 복구')

            page = context.new_page()
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
            page.wait_for_function("window.__raceAudioPlays.length && window.__raceAudioPlays.every(play => play.status !== 'pending')")
            assert '음악을 재생하지 못했어요' not in page.locator('[data-spectator-message]').inner_text(), '사용자 소리 끄기를 재생 오류로 표시'
            page.locator('[data-action="sound"]').click()
            page.wait_for_function("window.__raceAudioPlays.some(play => play.src.endsWith('bgm-spring.mp3') && play.status === 'fulfilled')")
            page.locator('[data-action="sound"]').click()
            page.wait_for_function("window.__raceAudioPlays.length && window.__raceAudioPlays.every(play => play.status !== 'pending')")
            assert '재생하지 못했어요' not in page.locator('[data-spectator-message]').inner_text(), '사용자 음원 끄기를 BGM·효과음 오류로 표시'
            if args.sound_only:
                assert not errors, '소리 재검수 중 실행 오류: ' + '; '.join(errors)
                report = {'통과': ['첫 무음·선택 전 음원 요청 없음·실제 BGM 재생 fulfilled·빠른 BGM/효과음 끄기에 허위 재생 오류 없음'], '운영 요청': '로컬 127.0.0.1 이외 전부 차단'}
                page.screenshot(path=str(output / 'sound-toggle.png'), full_page=True)
                (output / 'sound-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
                print(json.dumps(report, ensure_ascii=False, indent=2))
                context.close()
                browser.close()
                return
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
            page.locator('.sr-runner').nth(0).click()
            page.locator('[data-amount]').fill('1500')
            network_control['lose_ticket_reply'] = True
            page.locator('[data-action="buy"]').click()
            page.locator('[data-action="retry-purchase"]').wait_for(state='visible')
            after_lost_reply = command('ledger')
            assert network_control['committed_status'] == 200
            assert after_lost_reply['me']['wallet']['balance'] == 28500
            with page.expect_response(lambda response: response.url.endswith('/api/slime-race/tickets') and response.request.method == 'POST') as replay:
                page.locator('[data-action="retry-purchase"]').click()
            assert replay.value.status == 200
            page.wait_for_function("!document.querySelector('[data-action=buy]').disabled")
            assert command('ledger')['ledger'] == after_lost_reply['ledger'], '응답 유실 재확인 중복 차감'
            checks.append('서버 저장 후 응답 유실을 주입해 같은 요청 재확인·중복 차감 없음')
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
            page.set_viewport_size({'width': 320, 'height': 800})
            page.reload(wait_until='networkidle')
            page.locator('[data-action="ticket"]').click()
            page.locator('.sr-runner').nth(4).wait_for()
            first_meta = page.locator('.sr-runner-detail').first.bounding_box()
            visible_list = page.locator('.sr-ticket-scroll').bounding_box()
            assert first_meta['y'] >= visible_list['y'] and first_meta['y'] + first_meta['height'] <= visible_list['y'] + visible_list['height'], '320px 초기 창에서 첫 선수 세 항목이 가려짐'
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), '320px 초기 창 가로 넘침'
            page.screenshot(path=str(output / 'mobile-320-initial-ticket.png'), full_page=True)
            checks.append('320×800 새로고침 후 처음 연 창에서 첫 선수 세 항목 전체가 스크롤 없이 보임')
            page.keyboard.press('Escape')
            page.locator('#sr-ticket').wait_for(state='hidden')
            page.set_viewport_size({'width': 390, 'height': 844})
            page.locator('[data-action="ticket"]').click()
            page.locator('#sr-ticket').wait_for(state='visible')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), '모바일 가로 넘침'
            details = page.locator('.sr-runner-detail').first.evaluate('(el) => ({display:getComputedStyle(el).display, columns:getComputedStyle(el).gridTemplateColumns.split(" ").length})')
            assert details['display'] == 'grid' and details['columns'] == 3, '모바일 선수 정보 세 열 누락'
            assert page.locator('#sr-ticket').bounding_box()['y'] >= 0, '모바일 시트 상단 넘침'
            page.screenshot(path=str(output / 'mobile-dialog.png'), full_page=True)
            checks.append('PC 팝업·390px 모바일 시트·세 열 정보·Escape 초점 복귀·감소 모션 환경')

            # 판매 종료 직전에는 고정 폴링 5초를 기다리지 않고 경계를 재조회한다.
            command('time', elapsed=499000, live=True)
            with page.expect_response(lambda response: response.url.endswith('/api/slime-race/state') and response.json()['round']['phase'] == 'countdown', timeout=2500):
                page.reload(wait_until='domcontentloaded')
            checks.append('판매 종료 1초 전 실시간 시계에서 2.5초 안에 마감 서버 상태 재조회')
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
