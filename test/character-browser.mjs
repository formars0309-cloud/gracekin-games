/* 실제 로컬 서버·격리 DB에서 만들기 → 저장 → 성장·분배를 검증한다.
 * 통합 후: PLAYWRIGHT_MODULE=/절대경로/playwright/index.mjs node test/character-browser.mjs
 * 그림 납품 전: CHARACTER_FIXTURE_ART=1을 붙인다.
 * 서버 통합 전: CHARACTER_SERVER_ROOT=/서버작업자/워크트리를 추가한다.
 * 운영 API·DB는 사용하지 않는다. 임시 서버 사본과 DB는 종료할 때 제거한다.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, cp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { registerAndLogin } from './account-helpers.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../',import.meta.url));
const serverRoot = resolve(process.env.CHARACTER_SERVER_ROOT || root);
const captures = resolve(process.env.CHARACTER_CAPTURE_DIR || join(root,'reports/2026-11-19-캐릭터-화면/캡처'));
const temporary = await mkdtemp(join(tmpdir(),'gracekin-character-ui-'));
const runtime = join(temporary,'runtime'), mailbox = [], errors = [], checks = [];
let app, browser, db;
const record = (name,detail) => checks.push({ name, detail });
try {
  // 다른 작업자가 서버를 수정하는 중이어도 시험 중인 사본은 바뀌지 않는다.
  await mkdir(join(runtime,'assets/character'),{recursive:true});
  await cp(join(serverRoot,'server'),join(runtime,'server'),{recursive:true});
  await cp(join(serverRoot,'assets/character/model.js'),join(runtime,'assets/character/model.js'));
  await writeFile(join(runtime,'package.json'),'{"type":"module"}\n');
  await symlink(join(root,'node_modules'),join(runtime,'node_modules'),'dir');
  const { startServer } = await import(pathToFileURL(join(runtime,'server/app.js')));
  const dataDir = join(temporary,'data');
  app = await startServer({ port:0, rootDir:root, dataDir, nodeEnv:'test', mailer:async mail => mailbox.push(mail), guardianReplyTo:'support@example.test', grainRewardsStartTimer:false, rateLimit:{authMax:200,writeMax:200} });
  db = new DatabaseSync(join(dataDir,'community.sqlite'));
  await mkdir(captures,{recursive:true});
  browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE} : {})});
  async function api(context,path,body,method = body ? 'POST' : 'GET',expected = 200) {
    const response = await context.request.fetch(`${app.origin}/api${path}`,{method,...(body ? {data:body,headers:{origin:app.origin}} : {})});
    assert.equal(response.status(),expected,`${method} ${path}`);return response.json();
  }
  async function attachFixtures(context) {
    if (serverRoot !== root) await context.route('**/assets/character/model.js',route => route.fulfill({path:join(runtime,'assets/character/model.js'),contentType:'text/javascript'}));
    if (process.env.CHARACTER_FIXTURE_ART === '1') {
      await context.route('**/assets/character/manifest.json',route => route.fulfill({path:join(root,'test/fixtures/character/manifest.json'),contentType:'application/json'}));
      await context.route('**/assets/character/*.png',route => {
        const filename = new URL(route.request().url()).pathname.split('/').at(-1);
        return route.fulfill({path:join(root,'test/fixtures/character',filename),contentType:'image/png'});
      });
    }
  }
  async function ready(page) {
    await page.locator('#character-app:not([hidden])').waitFor();
    await page.waitForFunction(() => document.getElementById('character-canvas').getContext('2d').getImageData(0,0,512,768).data.some((value,i) => i%4===3 && value > 0));
  }
  async function noOverflow(page) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '휴대전화 가로 넘침 없음');
  }
  async function capture(page,name) { await noOverflow(page); await page.evaluate(() => scrollTo(0,0)); await page.screenshot({path:join(captures,`${name}.png`),fullPage:true}); }
  for (const viewport of [{width:1320,height:890},{width:390,height:844}]) {
    const suffix = viewport.width === 390 ? '휴대전화' : '데스크톱';
    const context = await browser.newContext({viewport}); await attachFixtures(context);
    const page = await context.newPage();page.on('pageerror',error => errors.push(error.message));
    await page.goto(`${app.origin}/character/?from=browser-test`);await ready(page);
    // 라디오의 기본 키보드 조작과 초안 복원.
    await page.getByRole('radio',{name:'고양이 수인',exact:false}).focus();await page.keyboard.press('Space');
    await page.reload();await ready(page);assert.equal(await page.locator('input[name=race][value=cat]').isChecked(),true);
    await page.getByRole('button',{name:'다음',exact:true}).click();
    await page.getByRole('radio',{name:'긴 생머리',exact:true}).check();await page.getByRole('radio',{name:'금빛',exact:true}).check();
    await capture(page,`${suffix}-꾸미기`);
    await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByRole('radio',{name:/숲길잡이/}).check();
    await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByRole('button',{name:'이 모습으로 저장'}).click();
    assert.match(await page.locator('#character-error').textContent(),/로그인/);
    record(`${suffix} 손님 초안`,'키보드 종족 선택·새로고침 복원·로그인 안내');
    const login = await registerAndLogin(app,mailbox,{name:`모험가${viewport.width}`,email:`character-${viewport.width}@example.test`,password:randomBytes(24).toString('base64url'),ageBand:'14plus'});
    assert.equal(login.status,200);
    await context.addCookies((login.headers['set-cookie'] || []).map(value => {
      const pair=value.split(';')[0], index=pair.indexOf('=');return {name:pair.slice(0,index),value:pair.slice(index+1),url:app.origin};
    }));
    await page.reload();await ready(page);
    assert.equal(await page.locator('input[name=race][value=cat]').isChecked(),true);
    for (let i=0;i<3;i++) await page.getByRole('button',{name:'다음',exact:true}).click();
    await page.getByRole('button',{name:'이 모습으로 저장'}).click();await page.getByRole('heading',{name:'내 캐릭터',exact:true}).waitFor();
    const saved = (await api(context,'/character/me')).character;
    assert.equal(saved.data.race,'cat');assert.equal(saved.data.job,'ranger');assert.equal(saved.data.appearance.hair,'h2');assert.equal(saved.data.appearance.hairColor,'c2');
    await capture(page,`${suffix}-저장`);
    // 경험치는 운영 API로 조작하지 않는다. 격리한 시험 DB에서 레벨 2 상황만 준비한다.
    db.prepare('UPDATE characters SET totalExp=100,revision=revision+1 WHERE id=?').run(saved.id);
    await page.reload();await ready(page);await page.getByRole('heading',{name:'남은 포인트 3점'}).waitFor();
    await page.getByRole('button',{name:'힘에 1점 분배',exact:true}).focus();await page.keyboard.press('Enter');
    await page.getByRole('heading',{name:'남은 포인트 2점'}).waitFor();
    assert.equal((await api(context,'/character/me')).character.alloc.str,1);
    assert.equal(await page.getByRole('button',{name:'힘에 1점 분배',exact:true}).evaluate(node => node === document.activeElement),true);
    await page.getByRole('button',{name:'오늘 출석하기 · 경험치 30'}).click();await page.getByRole('button',{name:'오늘 출석 완료'}).waitFor();
    assert.equal((await api(context,'/character/me')).character.progress.totalExp,130);
    await capture(page,`${suffix}-성장`);
    record(`${suffix} 저장·분배·출석`,'실제 API 저장값·격리 DB 분배 1점·출석 30·키보드 초점·가로 넘침 확인');
    await page.getByRole('button',{name:'분배 포인트 초기화',exact:true}).click();await page.getByRole('button',{name:'취소',exact:true}).click();
    assert.equal((await api(context,'/character/me')).character.alloc.str,1);
    await page.getByRole('button',{name:'분배 포인트 초기화',exact:true}).click();await page.getByRole('button',{name:'초기화하기',exact:true}).click();
    await page.getByRole('heading',{name:'남은 포인트 3점'}).waitFor();assert.equal((await api(context,'/character/me')).character.alloc.str,0);
    assert.equal(await page.getByRole('button',{name:'분배 포인트 초기화',exact:true}).isDisabled(),true);
    // 두 창의 동시 수정은 실제 버전 충돌로 막히며 최신 상태를 명시적으로 불러온다.
    const before = (await api(context,'/character/me')).character;
    await api(context,'/character/me/allocate',{revision:before.revision,stat:'agi',amount:1});
    await page.getByRole('button',{name:'힘에 1점 분배',exact:true}).click();await page.locator('#character-error:not([hidden])').waitFor();
    assert.match(await page.locator('#character-error').textContent(),/다른 창/);
    await page.getByRole('button',{name:'최신 캐릭터 다시 불러오기'}).click();await page.getByRole('heading',{name:'남은 포인트 2점'}).waitFor();
    record(`${suffix} 초기화·충돌`,'취소 시 분배 유지·초기화 후 무료 날짜 잠김·실제 409 뒤 최신 상태 복원');
    await page.getByRole('button',{name:'외형 바꾸기',exact:true}).click();await page.getByRole('radio',{name:'단정한 단발',exact:true}).check();await page.getByRole('button',{name:'다음',exact:true}).click();
    assert.equal(await page.locator('#panel-title').textContent(),'캐릭터 바꾸기 · 확인하고 저장');
    await page.getByRole('button',{name:'이 모습으로 저장'}).click();await page.getByRole('heading',{name:'내 캐릭터',exact:true}).waitFor();
    assert.equal((await api(context,'/character/me')).character.data.appearance.hair,'h3');
    await page.goto(`${app.origin}/account/`);await page.locator('#member-panel:not([hidden])').waitFor();await page.locator('#member-character-portrait:not([hidden])').waitFor();
    assert.equal(await page.locator('#member-character-link').textContent(),'내 캐릭터');
    record(`${suffix} 계정 초상`,'저장한 캐릭터 초상·내 캐릭터 링크 표시');
    const post = (await api(context,'/community/posts',{game:'slimeline',board:'free',title:`캐릭터 초상 시험 ${suffix}`,body:'내 캐릭터와 함께한 첫 모험 이야기예요.'},'POST',201)).post;
    await api(context,`/community/posts/${post.id}/comments?game=slimeline`,{body:'댓글 옆에도 내 초상이 보여요.'},'POST',201);
    await page.goto(`${app.origin}/community/?game=slimeline&board=free&post=${post.id}`);
    await page.locator('#article-author .author-portrait:not([hidden])').waitFor();
    await page.locator('.comment-meta .author-portrait:not([hidden])').waitFor();
    assert.equal(await page.locator('#article-author .author-portrait').evaluate(node => getComputedStyle(node).width),'32px');
    record(`${suffix} 커뮤니티 초상`,'실제 글·댓글 API의 author.character를 32px 초상으로 표시');
    // 시험 DB에서 레벨과 칭호를 준비한 뒤 잠금과 외형 변경의 경계를 확인한다.
    db.prepare('UPDATE characters SET totalExp=1800,alloc=?,revision=revision+1 WHERE id=?').run(JSON.stringify({str:25}),saved.id);
    await page.goto(`${app.origin}/character/`);await ready(page);
    assert.equal(await page.getByRole('button',{name:'종족·직업 바꾸기',exact:true}).isDisabled(),true);
    assert.ok(await page.locator('.title-list li').count() > 0);
    assert.equal(await page.getByRole('button',{name:'외형 바꾸기',exact:true}).isEnabled(),true);
    record(`${suffix} 성장 잠금·칭호`,'레벨 10 이상에서 종족·직업 잠금·외형 변경 유지·스탯 칭호 표시');
    await page.getByRole('button',{name:'외형 바꾸기',exact:true}).click();
    await page.getByRole('radio',{name:'높은 포니테일',exact:true}).check();
    await page.getByRole('button',{name:'다음',exact:true}).click();
    await api(context,'/auth/sign-out',{});
    await page.getByRole('button',{name:'이 모습으로 저장'}).click();
    await page.locator('#character-error:not([hidden])').waitFor();
    assert.match(await page.locator('#character-error').textContent(),/로그인/);
    assert.equal(await page.getByRole('link',{name:'로그인하고 돌아오기'}).isVisible(),true);
    await page.getByRole('button',{name:'이전',exact:true}).click();
    assert.equal(await page.getByRole('radio',{name:'높은 포니테일',exact:true}).isChecked(),true);
    record(`${suffix} 로그인 만료`,'실제 401 안내·화면 내 외형 선택 보존·로그인 링크 표시');
    await context.close();
  }
  const blocked = await browser.newContext({viewport:{width:390,height:844}});
  await attachFixtures(blocked);
  await blocked.addInitScript(() => Object.defineProperty(window,'localStorage',{get(){throw new DOMException('차단','SecurityError');}}));
  const blockedPage = await blocked.newPage();blockedPage.on('pageerror',error => errors.push(error.message));
  await blockedPage.goto(`${app.origin}/character/`);await ready(blockedPage);
  await blockedPage.getByRole('radio',{name:/고양이 수인/}).check();
  assert.match(await blockedPage.locator('#draft-note').textContent(),/보관할 수 없어요/);
  await noOverflow(blockedPage);await blocked.close();
  record('저장소 차단','localStorage 접근 자체가 거부되어도 만들기·미리보기 유지');
  assert.deepEqual(errors,[],'브라우저 자바스크립트 오류 없음');
  await writeFile(join(captures,'검증.json'),JSON.stringify({그림:process.env.CHARACTER_FIXTURE_ART === '1'?'시험용 단색 부품':'운영 manifest',검증:checks,오류:errors},null,2)+'\n');
  console.log(`브라우저 검증 통과: ${checks.length}개 시나리오, 두 화면 크기, 자바스크립트 오류 ${errors.length}개`);
} finally {
  await browser?.close(); db?.close(); await app?.close(); await rm(temporary,{recursive:true,force:true});
}
