import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../assets/shared/account-header.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function screen(url = 'https://gracekingames.com/') {
  const listeners = {}, documentListeners = {}, calls = [], nodes = new Map(), timers = new Map();
  let nextTimer = 0;
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', hidden: false, attributes: {}, events: {},
      setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(name, callback) { this.events[name] = callback; }, querySelector: node,
    });
    return nodes.get(selector);
  }
  const document = { hidden: false, querySelector: node, addEventListener(name, callback) { documentListeners[name] = callback; } };
  const window = { addEventListener(name, callback) { listeners[name] = callback; } };
  function fetch(url, options) {
    // 취소 신호 이후 도착하는 응답도 일부러 전달해 오래된 비동기 응답을 시험합니다.
    return new Promise((resolve, reject) => calls.push({ url, options, respond: (data, status = 200) => resolve({ ok: status === 200, json: async () => data }), reject }));
  }
  runInNewContext(source, { window, document, location: new URL(url), URLSearchParams, AbortController, Intl, fetch,
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id),
  });
  return { node, calls, document, event: (name, event = {}) => listeners[name](event), visibility(hidden) { document.hidden = hidden; documentListeners.visibilitychange(); } };
}
const label = ui => ui.node('[data-account-label]');
const balance = ui => ui.node('[data-account-balance]');
const link = ui => ui.node('[data-account-link]');
const grain = ui => ui.node('[data-account-grain]');
const retry = ui => ui.node('[data-account-retry]');

test('Pages 상단은 고정 summary에 자격증명만 전송하고 로딩·오류 때 가짜 0을 표시하지 않음', async () => {
  for (const host of ['gracekingames.com', 'www.gracekingames.com']) {
    const ui = screen(`https://${host}/`);
    assert.equal(ui.calls[0].url, 'https://community.gracekingames.com/api/account/summary');
    assert.equal(ui.calls[0].options.credentials, 'include'); assert.equal(ui.calls[0].options.headers, undefined);
    assert.equal(ui.calls[0].options.cache, 'no-store');
    assert.equal(label(ui).textContent, '내 계정'); assert.equal(balance(ui).textContent, ''); assert.equal(grain(ui).hidden, true);
    ui.calls[0].reject(new Error('시험용 연결 실패')); await flush();
    assert.equal(label(ui).textContent, '내 계정'); assert.equal(balance(ui).textContent, ''); assert.equal(retry(ui).hidden, false);
    retry(ui).events.click();
    ui.calls[1].respond({ user: { name: '가입회원', grainBalance: 30000 } }); await flush();
    assert.equal(label(ui).textContent, '가입회원'); assert.equal(balance(ui).textContent, '30,000 그레인');
    assert.equal(grain(ui).hidden, false); assert.equal(retry(ui).hidden, true);
    ui.event('pageshow'); ui.calls[2].respond({ user: null }); await flush();
    assert.equal(label(ui).textContent, '로그인'); assert.equal(balance(ui).textContent, ''); assert.equal(grain(ui).hidden, true);
  }
});

test('늦은 이전 응답은 최신 계정을 덮어쓰지 않고 숨김·복귀·다른 탭 세션 변경 때 다시 확인함', async () => {
  const ui = screen();
  ui.event('focus');
  assert.equal(ui.calls[0].options.signal.aborted, true);
  ui.calls[1].respond({ user: { name: '새회원', grainBalance: 12345 } }); await flush();
  ui.calls[0].respond({ user: { name: '이전회원', grainBalance: 99999 } }); await flush();
  assert.equal(label(ui).textContent, '새회원'); assert.equal(balance(ui).textContent, '12,345 그레인');
  ui.visibility(true);
  assert.equal(label(ui).textContent, '내 계정'); assert.equal(balance(ui).textContent, '');
  ui.event('focus'); assert.equal(ui.calls.length, 2);
  ui.visibility(false); assert.equal(ui.calls.length, 3);
  ui.event('pagehide');
  ui.calls[2].respond({ user: { name: '이탈후응답', grainBalance: 333 } }); await flush();
  assert.equal(balance(ui).textContent, ''); assert.equal(label(ui).textContent, '내 계정');
  ui.event('pageshow'); ui.calls[3].respond({ user: { name: '돌아온회원', grainBalance: 30000 } }); await flush();
  assert.equal(balance(ui).textContent, '30,000 그레인');
  ui.event('blur'); assert.equal(balance(ui).textContent, '');
  ui.event('focus'); ui.calls[4].respond({ user: null }); await flush();
  assert.equal(label(ui).textContent, '로그인'); assert.equal(grain(ui).hidden, true);
});

test('같은 탭 로그아웃 시작 즉시 표시를 비우고 완료 전에는 오래된 응답도 다시 표시하지 않음', async () => {
  const ui = screen('https://community.gracekingames.com/community/?game=gyeongguk');
  assert.equal(ui.calls[0].url, '/api/account/summary'); assert.equal(ui.calls[0].options.credentials, 'same-origin');
  ui.calls[0].respond({ user: { name: '로그아웃회원', grainBalance: 30000 } }); await flush();
  ui.event('focus');
  ui.event('gracekin-account-change', { detail: { phase: 'clear' } });
  assert.equal(balance(ui).textContent, ''); assert.equal(label(ui).textContent, '내 계정');
  ui.event('focus'); assert.equal(ui.calls.length, 2);
  ui.calls[1].respond({ user: { name: '로그아웃회원', grainBalance: 30000 } }); await flush();
  assert.equal(balance(ui).textContent, '');
  ui.event('gracekin-account-change', { detail: { phase: 'refresh' } });
  ui.calls[2].respond({ user: null }); await flush();
  assert.equal(label(ui).textContent, '로그인'); assert.equal(grain(ui).hidden, true);
});

test('로컬·게임별 계정 링크 문맥과 긴 닉네임·큰 잔액의 접근성 이름을 보존함', async () => {
  const name = '가'.repeat(24);
  for (const [path, game] of [['/games/slimeline/', 'slimeline'], ['/games/gyeongguk/', 'gyeongguk'], ['/community/?game=gyeongguk', 'gyeongguk'], ['/', null]]) {
    const ui = screen(`http://127.0.0.1:8766${path}`);
    assert.equal(link(ui).href, `/account/${game ? `?game=${game}` : ''}`);
    assert.equal(ui.calls[0].url, '/api/account/summary');
    ui.calls[0].respond({ user: { name, grainBalance: 9007199254740991 } }); await flush();
    assert.equal(label(ui).textContent, name);
    assert.equal(balance(ui).textContent, '9,007,199,254,740,991 그레인');
    assert.equal(link(ui).attributes['aria-label'], `${name}님, 9,007,199,254,740,991 그레인, 내 계정 열기`);
    ui.event('focus'); ui.calls[1].respond({ user: { name, grainBalance: '0' } }); await flush();
    assert.equal(balance(ui).textContent, ''); assert.equal(grain(ui).hidden, true); assert.equal(retry(ui).hidden, false);
  }
});
