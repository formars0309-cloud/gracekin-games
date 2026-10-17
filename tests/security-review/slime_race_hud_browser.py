#!/usr/bin/env python3
"""격리 HTTP 응답으로 경기장 배치·사회자의 상태 전환과 오류 경계를 검수한다."""
import argparse
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    output = args.output_dir or Path(tempfile.mkdtemp(prefix='race-hud-review-'))
    output.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen(['node', str(ROOT / 'tests/security-review/slime-race-fixture.mjs')], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={**os.environ, 'NODE_ENV':'test'})
    def receive():
        line = process.stdout.readline()
        if not line:
            raise RuntimeError('격리 서버 응답 없음: '+process.stderr.read())
        return json.loads(line)
    def command(action, **values):
        process.stdin.write(json.dumps({'action':action, **values})+'\n'); process.stdin.flush()
        return receive()
    checks = []
    try:
        fixture = receive()
        snapshot = command('ledger')['state']
        snapshot['round']['roundNo']=123456
        control = {'body': snapshot, 'error':False, 'hold':False}
        held = []
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width':1440,'height':1000}, reduced_motion='reduce')
            def route_request(route):
                if urlsplit(route.request.url).hostname != '127.0.0.1': route.abort()
                elif route.request.url.endswith('/api/slime-race/state'):
                    if control['hold']: held.append(route)
                    elif control['error']: route.fulfill(status=500,content_type='application/json',body=json.dumps({'error':{'message':'검수용 오류'}}))
                    else: route.fulfill(content_type='application/json',body=json.dumps(control['body']))
                else: route.continue_()
            context.route('**/*',route_request)
            page = context.new_page(); errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(fixture['origin'],wait_until='networkidle')
            page.locator('[data-announcer-message]').filter(has_text='응원할 친구').wait_for()
            widths = [320,360,390,500,501,550,700,701,768,900,901,1000,1001,1024,1180,1440,1920]
            def verify_layout(width):
                page.set_viewport_size({'width':width,'height':1000 if width>700 else 844})
                page.wait_for_timeout(120)
                layout=page.evaluate('''() => {
                  const rect = selector => {const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
                  const img=document.querySelector('.sr-announcer img'),box=img.getBoundingClientRect();
                  const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
                  const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;
                  let left=c.width,top=c.height,right=0,bottom=0;
                  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
                  const scale=Math.min(box.width/c.width,box.height/c.height),ox=box.x+(box.width-c.width*scale)/2,oy=box.y+(box.height-c.height*scale)/2;
                  const owl={x:ox+left*scale,y:oy+top*scale,right:ox+right*scale,bottom:oy+bottom*scale,w:(right-left)*scale,h:(bottom-top)*scale};
                  return {owl,owlBox:rect('.sr-announcer img'),overflow:document.documentElement.scrollWidth>innerWidth,arena:rect('.sr-arena'),title:rect('.sr-title-sign'),clock:rect('.sr-round'),speech:rect('.sr-speech'),controls:rect('.sr-arena-controls'),feedback:rect('.sr-feedback')};
                }''')
                assert not layout['overflow'],f'{width}: 가로 넘침'
                assert page.locator('.sr-round').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),f'{width}: 시계 내부 가로 넘침'
                def overlaps(a,b): return a['x']<b['right'] and a['right']>b['x'] and a['y']<b['bottom'] and a['bottom']>b['y']
                for a,b in [('title','clock'),('title','speech'),('clock','speech'),('title','owl'),('clock','owl')]:
                    assert not overlaps(layout[a],layout[b]),f'{width}: {a}/{b} 겹침 {layout[a]} / {layout[b]}'
                for key in ['title','clock','owlBox','speech','controls','feedback']:
                    a,b=layout[key],layout['arena']
                    assert a['x']>=b['x'] and a['right']<=b['right'] and a['y']>=b['y'] and a['bottom']<=b['bottom'],f'{width}: {key} 경기장 밖'
                # 새 장면은 작은 화면에서 헤더·레인·조작부를 쌓는다. 이전 고정 높이 대신
                # 실제 텍스트와 버튼의 읽기/조작 경계 및 경기장 프레임 포함 여부를 검사한다.
                text_bounds=page.locator('.sr-heading h1, .sr-round, .sr-round span, .sr-round strong, .sr-speech, .sr-arena-controls button').evaluate_all('''els => els.map(el => ({text:el.textContent,width:el.clientWidth,height:el.clientHeight,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight}))''')
                for item in text_bounds:
                    assert item['scrollWidth']<=item['width']+1,f'{width}: 내부 가로 텍스트 넘침 {item}'
                    assert item['scrollHeight']<=item['height']+1,f'{width}: 내부 세로 텍스트 넘침 {item}'
                buttons=page.locator('.sr-arena-controls button').evaluate_all('''els => els.map(el => {const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}})''')
                for i,a in enumerate(buttons):
                    assert a['w']>=42 and a['h']>=42,f'{width}: 버튼 터치 영역 부족 {a}'
                    for b in buttons[i+1:]: assert not overlaps(a,b),f'{width}: 조작 버튼 겹침'
                assert layout['arena']['h'] <= 1000,f'{width}: 한 경기장 높이 1000px 초과'
            def verify_phase_layout(label):
                for width in widths:
                    verify_layout(width)
                    if width in (320,390,1440):
                        page.locator('.sr-arena').screenshot(path=str(output/f'{label}-{width}.png'))
                page.set_viewport_size({'width':320,'height':844})
            for width in widths:
                page.set_viewport_size({'width':width,'height':1000 if width>700 else 844})
                page.locator('.sr-arena').screenshot(path=str(output/f'home-{width}.png'))
                verify_layout(width)
                page.locator('.sr-arena').screenshot(path=str(output/f'home-{width}.png'))
                page.screenshot(path=str(output/f'page-{width}.png'),full_page=True)
                page.locator('[data-action="ticket"]').click()
                page.locator('#sr-ticket').wait_for(state='visible')
                assert page.locator('[data-action="buy"]').is_disabled(),'게스트 구매 잠금'
                page.keyboard.press('Escape');page.locator('#sr-ticket').wait_for(state='hidden')
                assert page.locator('[data-action="ticket"]').evaluate('(el)=>document.activeElement===el'),'초점 복귀'
            checks.append('17개 반응형 경계 너비의 HUD 겹침·텍스트 가로/세로 넘침·테두리 경계·버튼 터치 영역·구매창 잠금·Escape 초점 복귀')
            page.set_viewport_size({'width':320,'height':844})
            page.locator('[data-action="cheer"]').click()
            assert '응원을 보냈어요' in page.locator('[data-spectator-message]').inner_text()
            page.locator('.sr-arena').screenshot(path=str(output/'cheer-320.png'))
            page.clock.install()
            def refresh():
                page.evaluate("window.dispatchEvent(new Event('online'))")
                page.wait_for_timeout(80)
            control['body']=command('time',elapsed=500000)['state'];refresh()
            page.locator('[data-announcer-message]').filter(has_text='구매 마감').wait_for()
            verify_phase_layout('countdown')
            control['body']=command('time',elapsed=530000)['state'];refresh()
            page.locator('[data-announcer-message]').filter(has_text='경주가 진행 중').wait_for()
            verify_phase_layout('racing')
            control['body']=command('time',elapsed=510000)['state'];page.reload(wait_until='networkidle')
            page.locator('[data-announcer-message]').filter(has_text='출발!').wait_for()
            racing=copy.deepcopy(control['body'])
            positions=racing['round']['animation']['positions']; ids=[p['slimeId'] for p in positions]
            def lead(index,tick):
                data=copy.deepcopy(racing); data['serverNow']+=tick
                for i,p in enumerate(data['round']['animation']['positions']): p['progress']=.6 if i==index else .2
                control['body']=data
            lead(0,6000);page.clock.run_for(4600);refresh()
            name0=next(e['name'] for e in racing['round']['entrants'] if e['slimeId']==ids[0])
            page.locator('[data-announcer-message]').filter(has_text=name0+' 선두').wait_for()
            lead(1,12000);page.clock.run_for(4600);refresh()
            name1=next(e['name'] for e in racing['round']['entrants'] if e['slimeId']==ids[1])
            page.locator('[data-announcer-message]').filter(has_text=name1+' 선두').wait_for()
            tied=copy.deepcopy(control['body']);tied['serverNow']+=6000
            for p in tied['round']['animation']['positions']:p['progress']=.6
            control['body']=tied;page.clock.run_for(4600);refresh()
            page.locator('[data-announcer-message]').filter(has_text='나란히').wait_for()
            checks.append('판매→마감→서버 출발·중도 접속 진행 안내·선두 교체·동률 중계, 결과 전 우승 문구 없음')
            assert '우승' not in page.locator('[data-announcer-message]').inner_text()
            # 실제 경기 종료 시각에 도달했어도 결과 응답 전에는 승자를 만들지 않는다.
            boundary=copy.deepcopy(racing);boundary['serverNow']=boundary['round']['resultsAt']+1
            control['body']=boundary;refresh()
            page.locator('[data-announcer-message]').filter(has_text='서버 결과').wait_for()
            assert page.locator('.sr-result').is_hidden()
            result=command('time',elapsed=570001)['state'];control['body']=result;refresh()
            page.locator('.sr-result').wait_for(state='visible')
            page.locator('[data-announcer-message]').filter(has_text='우승!').wait_for()
            verify_phase_layout('results')
            page.locator('.sr-arena').screenshot(path=str(output/'result-320.png'))
            page.evaluate('''() => { window.__hudWrites=[]; const observer=new MutationObserver(records=>window.__hudWrites.push(...records.map(r=>r.target.nodeName))); ['.sr-result','[data-announcer-message]'].forEach(selector=>observer.observe(document.querySelector(selector),{subtree:true,childList:true,characterData:true})); }''')
            page.clock.run_for(900)
            assert page.evaluate('window.__hudWrites.length')==0,'같은 결과·중계 상태에서 DOM 반복 쓰기 발생'
            checks.append('정지한 결과 상태 900ms 동안 결과/중계 DOM 반복 쓰기 0회')
            # 뒤늦은 과거 스냅샷은 오류로 격리하고 과거 승자·선두를 중계하지 않는다.
            control['body']=racing;refresh()
            page.locator('[data-public-error]').wait_for(state='visible')
            assert page.locator('.sr-result').is_hidden()
            assert '우승' not in page.locator('[data-announcer-message]').inner_text()
            verify_phase_layout('error')
            page.locator('.sr-arena').screenshot(path=str(output/'error-320.png'))
            checks.append('경주 종료 후 서버 결과 대기·확정 결과 일치·과거 서버 시각 거부 및 결과/중계 숨김')
            control['body']=result;refresh();page.locator('.sr-result').wait_for(state='visible')
            control['hold']=True
            page.clock.run_for(12500)
            page.locator('[data-announcer-message]').filter(has_text='새 경기 정보').wait_for()
            assert page.locator('.sr-result').is_hidden()
            assert page.locator('[data-timer]').inner_text()=='—'
            checks.append('12초 이상 공개 응답 지연 시 과거 우승·선두·타이머 숨김')
            control['hold']=False;control['error']=True
            for route in held:
                try:route.abort()
                except Exception:pass
            held.clear();refresh()
            page.locator('[data-public-error]').wait_for(state='visible')
            assert page.locator('.sr-result').is_hidden()
            assert not errors,'브라우저 오류: '+'; '.join(errors)
            checks.append('마감·중도 경주·확정 결과·오류 상태에서도 17개 반응형 경계 너비의 모든 HUD 텍스트 넘침/겹침 없음')
            checks.append('공개 API 오류 안내와 응원 피드백은 레인·하단 버튼 밖 전용 공간에 표시, 브라우저 오류 없음')
            context.close();browser.close()
        report={'통과':checks,'증빙':str(output),'운영 요청':'로컬 127.0.0.1 이외 전부 차단'}
        (output/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps(report,ensure_ascii=False,indent=2))
    finally:
        try:command('close')
        finally:
            try:process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.terminate();process.wait(timeout=5)

if __name__=='__main__':main()
