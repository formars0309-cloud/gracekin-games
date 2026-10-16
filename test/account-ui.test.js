import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../assets/account/account.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function screen() {
  const nodes = new Map(), windowListeners = {}, historyPaths = [];
  const user = { id: '본인계정', name: '보상회원', email: 'grain@example.test', canWriteCommunity: true };
  let signedIn = false;
  function element(id = '') {
    if (id && nodes.has(id)) return nodes.get(id);
    const node = {
      id, tagName: id.endsWith('-form') ? 'FORM' : 'DIV', hidden: false, textContent: '', value: '', children: [], events: {},
      addEventListener(name, action) { this.events[name] = action; }, setAttribute() {}, focus() {}, reset() {}, reportValidity() { return true; },
      querySelectorAll() { return []; }, replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); },
    };
    if (id) nodes.set(id, node);
    return node;
  }
  const panels = ['signin', 'age', 'signup', 'guardian', 'verify', 'forgot', 'reset', 'member'].map(name => element(`${name}-panel`));
  const window = {
    gracekinAccountEntry: { view: 'verify', token: '시험메일인증값', params: new URLSearchParams() },
    addEventListener(name, action) { windowListeners[name] = action; },
  };
  const document = {
    getElementById: element, createElement: () => element(),
    querySelectorAll: selector => selector === '.panel' ? panels : [],
  };
  async function fetch(path) {
    let data;
    if (path === '/api/account/config') data = { registrationAvailable: true, emailAvailable: true, guardianConsentAvailable: false };
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
