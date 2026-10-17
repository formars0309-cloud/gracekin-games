import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { GRAIN_REWARD_POLICY } from '../server/grain-policy.js';

const source = await readFile(new URL('../assets/account/account.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function screen({ policy = GRAIN_REWARD_POLICY, failConfig = false, view = 'verify' } = {}) {
  const nodes = new Map(), windowListeners = {}, historyPaths = [];
  const user = { id: '본인계정', name: '보상회원', email: 'grain@example.test', canWriteCommunity: true };
  let signedIn = false;
  function element(id = '') {
    if (id && nodes.has(id)) return nodes.get(id);
    const node = {
      id, tagName: id.endsWith('-form') ? 'FORM' : 'DIV', hidden: false, textContent: '', value: '', children: [], events: {},
      addEventListener(name, action) { this.events[name] = action; }, setAttribute() {}, focus() {}, reset() {}, reportValidity() { return true; },
      querySelectorAll() { return []; }, replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
    };
    if (id) nodes.set(id, node);
    return node;
  }
  const panels = ['signin', 'age', 'signup', 'guardian', 'verify', 'forgot', 'reset', 'member'].map(name => element(`${name}-panel`));
  const window = {
    gracekinAccountEntry: { view, token: '시험메일인증값', params: new URLSearchParams() },
    addEventListener(name, action) { windowListeners[name] = action; },
  };
  const document = {
    getElementById: element, createElement: () => element(),
    querySelectorAll: selector => selector === '.panel' ? panels : [],
  };
  async function fetch(path) {
    let data;
    if (path === '/api/account/config') {
      if (failConfig) throw new Error('격리 시험 연결 실패');
      data = { registrationAvailable: true, emailAvailable: true, guardianConsentAvailable: false, grainRewardPolicy: policy };
    }
    else if (path === '/api/account/session') data = { user: signedIn ? user : null };
    else if (path === '/api/account/grain') data = { balance: 30000, entries: [{ id: '원장', amount: 30000, reason: '신규 가입 이벤트', createdAt: new Date().toISOString() }] };
    else if (path === '/api/auth/sign-in/email') { signedIn = true; data = { status: true }; }
    else if (path === '/api/auth/sign-out') { signedIn = false; data = { status: true }; }
    else data = { status: true };
    return { ok: true, json: async () => data };
  }
  runInNewContext(source, { window, document, location: { hostname: 'community.gracekingames.com' }, history: { replaceState: (_a, _b, path) => historyPaths.push(path) }, fetch, URLSearchParams, AbortController, setTimeout, clearTimeout, Intl });
  return {
    node: element,
    click: id => element(id).events.click(),
    submit: id => element(id).events.submit({ preventDefault() {} }),
    async restore() { windowListeners.pagehide(); windowListeners.pageshow({ persisted: true }); await flush(); },
    expire() { signedIn = false; },
    currentView: () => new URL(historyPaths.at(-1), 'https://example.test').searchParams.get('view'),
  };
}

test('메일 확인으로 진입한 뒤 로그인한 계정은 BFCache 복원 시 현재 회원 화면과 잔액을 다시 읽음', async () => {
  const ui = screen();
  await flush();
  assert.equal(ui.currentView(), 'verify');
  ui.click('verify-confirm-button'); await flush();
  assert.equal(ui.currentView(), 'signin');
  ui.submit('signin-form'); await flush();
  assert.equal(ui.currentView(), 'member');
  assert.equal(ui.node('grain-balance').textContent, '30,000');
  await ui.restore();
  assert.equal(ui.currentView(), 'member');
  assert.equal(ui.node('member-panel').hidden, false);
  assert.equal(ui.node('grain-content').hidden, false);
  assert.equal(ui.node('grain-balance').textContent, '30,000');
  ui.expire(); await ui.restore();
  assert.equal(ui.currentView(), 'signin');
  assert.equal(ui.node('member-panel').hidden, true);
  assert.equal(ui.node('grain-balance').textContent, '');
});

const contents = node => [node.textContent, ...node.children.map(contents)].join('');

test('공개 표는 로그인·로그아웃 후에도 유지되고 모든 수치는 공개 설정으로 렌더함', async () => {
  const policy = structuredClone(GRAIN_REWARD_POLICY);
  Object.assign(policy.activity.attendance, { amount: 321, dailyLimit: 2 });
  Object.assign(policy.activity.post, { amount: 654, dailyLimit: 4, minBodyLength: 35 });
  Object.assign(policy.activity.comment, { amount: 123, dailyLimit: 11, minBodyLength: 12 });
  Object.assign(policy.activity, { dailyTotalLimit: 4321, confirmationDelayMs: 48 * 3600000 });
  policy.bugReport.simple.amount = 2345; policy.bugReport.normal.amount = 6789; policy.bugReport.critical.amount = 23456; policy.bestPost.amount = 3456;
  const ui = screen({ policy, view: 'signin' }); await flush();
  assert.equal(ui.node('grain-policy-content').hidden, false);
  const rows = ui.node('grain-policy-rows').children;
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map(row => row.children[0].textContent), ['출석', '글 작성', '댓글 작성', '버그 채택', '우수 글', '이벤트']);
  assert.ok(rows.every(row => row.children[0].scope === 'row'));
  for (const [index, expected] of [[0, ['321', '하루 2회']], [1, ['654', '하루 4회', '35자 이상']], [2, ['123', '하루 11회', '12자 이상', '본인 글 제외', '첫 댓글만']], [3, ['2,345', '6,789', '23,456', '최초 제보자만']], [4, ['3,456']], [5, ['이벤트 공지 지급량']]]) {
    for (const text of expected) assert.ok(contents(rows[index]).includes(text), `${index}행: ${text}`);
  }
  assert.match(ui.node('grain-policy-limit').textContent, /4,321.*한국 시간\(KST\) 0시/);
  assert.match(ui.node('grain-policy-delay').textContent, /48시간/);
  assert.match(ui.node('grain-pending-description').textContent, /48시간/);
  ui.submit('signin-form'); await flush();
  assert.equal(ui.currentView(), 'member');
  assert.equal(ui.node('grain-policy-content').hidden, false);
  await ui.click('signout-button'); await flush();
  assert.equal(ui.currentView(), 'signin');
  assert.equal(ui.node('grain-policy-content').hidden, false);
  assert.equal(contents(ui.node('grain-policy-rows')), rows.map(contents).join(''));
  assert.equal(ui.node('grain-balance').textContent, '');
});

test('정책 누락·연결 실패·문자열/음수/범위초과 수치는 표 대신 오류 안내를 표시하며 로그인은 유지', async () => {
  const invalid = [undefined, '<img src=x onerror=alert(1)>', -1, 0, Number.MAX_SAFE_INTEGER + 1];
  const cases = [{ failConfig: true }, { policy: null }, ...invalid.map(value => {
    const policy = structuredClone(GRAIN_REWARD_POLICY); policy.bugReport.critical.amount = value;
    return { policy };
  })];
  for (const options of cases) {
    const ui = screen({ ...options, view: 'signin' }); await flush();
    assert.equal(ui.node('grain-policy-content').hidden, true);
    assert.equal(ui.node('grain-policy-rows').children.length, 0);
    assert.match(ui.node('grain-policy-status').textContent, /불러오지 못했어요/);
    ui.submit('signin-form'); await flush();
    assert.equal(ui.currentView(), 'member');
  }
});

test('BFCache 복원은 최초 인증 화면 대신 현재 비밀번호 찾기·보호자 화면을 보존함', async () => {
  const ui = screen(); await flush();
  ui.click('open-forgot');
  assert.equal(ui.currentView(), 'forgot');
  await ui.restore();
  assert.equal(ui.currentView(), 'forgot');
  assert.equal(ui.node('forgot-panel').hidden, false);
  ui.click('choose-child');
  assert.equal(ui.currentView(), 'guardian');
  await ui.restore();
  assert.equal(ui.currentView(), 'guardian');
  assert.equal(ui.node('guardian-panel').hidden, false);
});
