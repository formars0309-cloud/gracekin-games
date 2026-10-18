import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { GRAIN_REWARD_POLICY } from '../server/grain-policy.js';

const source = await readFile(new URL('../assets/community/community.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const member = { id: '시험회원', name: '말랑이', canWriteCommunity: true };
const contents = node => [node.textContent, ...node.children.map(contents)].join('');

function screen({ game = 'slimeline', board = 'free', query = '', user = null, eligibility = 'eligible', policy = GRAIN_REWARD_POLICY, fail = [], delayed = [], total = 0, noOfficial = false } = {}) {
  const nodes = new Map(), calls = [], pending = new Map();
  function element(id = '') {
    if (id && nodes.has(id)) return nodes.get(id);
    const node = {
      id, textContent: '', value: '', hidden: true, disabled: false, open: false, children: [], events: {}, attributes: {}, dataset: {},
      classList: { add() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.events[name] = callback; },
      append(...items) { this.children.push(...items); }, prepend(...items) { this.children.unshift(...items); },
      replaceChildren(...items) { this.children = items; }, querySelectorAll() { return []; },
      querySelector() { return this.children.find(item => item.attributes['aria-current'] === 'page'); }, offsetLeft: 0,
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {},
    };
    if (id) nodes.set(id, node);
    return node;
  }
  const body = element('body');
  const document = { body, title: '', getElementById: element, createElement: () => element(), createElementNS: () => element(), querySelectorAll: () => [], querySelector: selector => selector.startsWith('meta') ? element('theme') : null };
  const address = new URL(`http://127.0.0.1/community/?${new URLSearchParams({ game, board, ...(query ? { q: query } : {}) })}`);
  const location = { hostname: address.hostname, search: address.search, href: address.href };
  const routes = {
    '/api/community/session': { user }, '/api/account/config': { grainRewardPolicy: policy },
    '/api/account/grain': { rewardEligibility: eligibility }, '/api/grain/attendance': { awarded: false },
    '/api/community/known-issues': { issues: [{ id: 'one' }, { id: 'two' }] },
    '/api/auth/sign-out': { success: true },
  };
  async function fetch(path) {
    calls.push(path);
    const key = path.startsWith('/api/community/posts?') ? '/api/community/posts' : path;
    const data = key === '/api/community/posts' ? { posts: [], page: 1, pageSize: 20, total } : routes[key];
    const response = () => {
      if (fail.includes(key)) throw new Error('시험용 연결 실패');
      return { ok: true, json: async () => data };
    };
    if (delayed.includes(key)) return new Promise(resolve => pending.set(key, () => resolve(response())));
    return response();
  }
  // 현재 내장 공지는 보존하며, 공지가 없는 가상의 데이터로 빈 안내도 확인한다.
  runInNewContext(noOfficial ? source.replace(/posts: \[/g, 'posts: [], unusedPosts: [') : source, { document, location, window: { addEventListener() {}, dispatchEvent() {} }, CustomEvent: class {}, fetch, URLSearchParams, AbortController, Intl, setTimeout: () => 1, clearTimeout() {} });
  return { node: element, calls, location, release: path => pending.get(path)(), click: id => element(id).events.click(), submit: id => element(id).events.submit({ preventDefault() {} }) };
}

test('게임별 이름·탭 그림·첫 화면을 분리하고 기존 게시판 주소를 보존함', async () => {
  for (const [game, expected] of [['slimeline', ['자유 이야기', '공략 나누기', '작품 자랑', '새 소식']], ['gyeongguk', ['자유 게시판', '덱 연구', '전략 이야기', '새 소식']]]) {
    const ui = screen({ game }); await flush();
    assert.deepEqual(ui.node('board-tabs').children.map(tab => contents(tab)), expected);
    const tabs = ui.node('board-tabs').children;
    assert.equal(tabs[0].href, `/community/?game=${game}&board=free`);
    assert.equal(tabs[0].attributes['aria-current'], 'page');
    assert.equal(tabs[0].children[0].attributes['aria-hidden'], 'true');
    assert.equal(ui.node('game-title').hidden, false);
    assert.equal(ui.node('game-title').src, `/assets/${game}/title.png`);
    assert.equal(ui.node('game-hero-art').hidden, false);
    assert.equal(ui.node('game-hero-art').src, `/assets/${game}/hero.webp`);
    assert.equal(ui.node('game-hero-art').attributes.fetchpriority, 'high');
    assert.equal(ui.node('hero-links').hidden, false);
    assert.equal(ui.node('hero-start').href, `https://${game}.gracekingames.com/`);
    assert.equal(ui.node('board-group-title').textContent, game === 'gyeongguk' ? '천하의 이야기' : '우리들의 이야기');
    assert.equal(ui.node('hero-home').href, `/games/${game}/`);
  }
});

test('비회원의 진짜 빈 게시판에는 그림·로그인·가입을 제공하고 작성·보상 약속을 숨김', async () => {
  const ui = screen(); await flush();
  assert.equal(ui.node('empty-state').hidden, false);
  assert.match(ui.node('empty-description').textContent, /아직 조용해요/);
  assert.equal(ui.node('empty-art').hidden, false);
  assert.equal(ui.node('empty-signin').hidden, false);
  assert.equal(ui.node('empty-signup').hidden, false);
  assert.equal(ui.node('empty-write').hidden, true);
  assert.equal(ui.node('empty-reward').hidden, true);
  assert.match(ui.node('session-label').textContent, /로그인하면 글·댓글/);
  ui.click('empty-signup');
  assert.equal(ui.location.href, '/account/?view=signup&game=slimeline&board=free');
});

test('자격 회원 첫 글 보상과 오른쪽 지급표는 서버 변경 수치와 지연 시간을 그대로 사용함', async () => {
  const policy = structuredClone(GRAIN_REWARD_POLICY);
  policy.activity.attendance.amount = 321; policy.activity.post.amount = 765; policy.activity.comment.amount = 123;
  policy.activity.post.minBodyLength = 42; policy.activity.post.dailyLimit = 4; policy.activity.confirmationDelayMs = 48 * 3600000;
  const ui = screen({ user: member, policy }); await flush();
  assert.equal(ui.node('empty-write').hidden, false);
  assert.equal(ui.node('empty-signin').hidden, true);
  assert.equal(ui.node('empty-reward').hidden, false);
  assert.match(ui.node('empty-reward').textContent, /48시간 뒤 765 그레인.*42자 이상.*4회/);
  const summary = contents(ui.node('grain-policy-summary'));
  for (const amount of [321, 765, 123]) assert.ok(summary.includes(String(amount)));
  assert.equal(ui.node('member-bar').hidden, true);
  assert.equal(ui.node('signout-button').hidden, false);
  ui.click('empty-write');
  assert.equal(ui.node('editor-dialog').open, true);
  assert.match(ui.node('editor-board').textContent, /자유 이야기/);
});

test('미인증·어린이·정지·쓰기 제한·자격 조회 오류에는 보상 문구가 없음', async () => {
  for (const options of [{ eligibility: 'unverified' }, { eligibility: 'under14' }, { eligibility: 'suspended' }, { user: { ...member, canWriteCommunity: false } }, { fail: ['/api/account/grain'] }]) {
    const ui = screen({ user: member, ...options }); await flush();
    assert.equal(ui.node('empty-reward').hidden, true);
    assert.equal(ui.node('empty-reward').textContent, '');
    assert.equal(ui.node('empty-write').hidden, options.user?.canWriteCommunity === false);
    assert.equal(ui.node('account-permission').hidden, options.user?.canWriteCommunity !== false);
  }
});

test('목록·회원·공개 정책·자격 응답 순서와 무관하게 첫 글 안내를 갱신함', async () => {
  const paths = ['/api/community/posts', '/api/community/session', '/api/account/config', '/api/account/grain'];
  for (const order of [paths, [paths[2], paths[1], paths[3], paths[0]], [paths[1], paths[3], paths[0], paths[2]]]) {
    const ui = screen({ user: member, delayed: paths });
    for (const path of order) { ui.release(path); await flush(); }
    assert.equal(ui.node('empty-write').hidden, false);
    assert.equal(ui.node('empty-reward').hidden, false);
    assert.match(ui.node('empty-reward').textContent, /24시간 뒤 500 그레인/);
  }
});

test('검색 없음·연결 실패·빈 페이지는 첫 글 버튼과 보상·슬라임을 표시하지 않음', async () => {
  for (const [options, title] of [[{ query: '없는말' }, '검색 결과가 없어요'], [{ fail: ['/api/community/posts'] }, '이야기를 불러오지 못했어요'], [{ total: 21 }, '이 페이지에는 글이 없어요']]) {
    const ui = screen({ user: member, ...options }); await flush();
    assert.equal(ui.node('empty-title').textContent, title);
    for (const id of ['empty-actions', 'empty-reward', 'empty-art']) assert.equal(ui.node(id).hidden, true);
  }
});

test('작품 자랑 안내와 게시판별 빈 문장, 알려진 문제 전체 게임 표기를 제공함', async () => {
  for (const [board, expected] of [['free', '첫 이야기를'], ['guide', '나만의 풀이'], ['gallery', '첫 작품']]) {
    const ui = screen({ board }); await flush();
    assert.ok(ui.node('empty-description').textContent.includes(expected));
    assert.equal(ui.node('gallery-notice').hidden, board !== 'gallery');
    assert.equal(ui.node('known-issues-count').textContent, '알려진 문제 2개 · 전체 게임');
    assert.ok(ui.calls.includes('/api/community/known-issues'));
    assert.ok(!ui.calls.some(path => path.startsWith('/api/community/known-issues?')));
  }
});

test('정책 누락·오류·잘못된 수치는 지급표와 보상을 숨기고 알려진 문제 실패도 별도 안내함', async () => {
  const invalidPolicies = [undefined, '300', -1, 0, Number.MAX_SAFE_INTEGER + 1].map(amount => {
    const policy = structuredClone(GRAIN_REWARD_POLICY); policy.activity.attendance.amount = amount;
    return { policy };
  });
  for (const options of [{ policy: null }, ...invalidPolicies, { fail: ['/api/account/config', '/api/community/known-issues'] }]) {
    const ui = screen({ user: member, ...options }); await flush();
    assert.equal(ui.node('empty-reward').hidden, true);
    assert.equal(ui.node('grain-policy-summary').hidden, true);
    assert.match(ui.node('grain-policy-status').textContent, /불러오지 못했어요/);
    if (options.fail) assert.match(ui.node('known-issues-count').textContent, /확인하지 못했어요/);
  }
});

test('로그아웃은 회원·보상·작성창을 비우고 빈 게시판의 로그인 안내를 복구함', async () => {
  const ui = screen({ user: member }); await flush();
  ui.click('empty-write');
  ui.node('post-title').value = '보존하면 안 되는 초안';
  await ui.click('signout-button'); await flush();
  assert.equal(ui.node('empty-reward').hidden, true);
  assert.equal(ui.node('empty-write').hidden, true);
  assert.equal(ui.node('empty-signin').hidden, false);
  assert.equal(ui.node('member-bar').hidden, false);
  assert.equal(ui.node('signout-button').hidden, true);
  assert.equal(ui.node('post-title').value, '');
  assert.equal(ui.node('editor-dialog').open, false);
});


test('늦은 자격 응답은 로그아웃 뒤 보상 안내를 되살리지 않음', async () => {
  const ui = screen({ user: member, delayed: ['/api/account/grain'] }); await flush();
  assert.equal(ui.node('empty-write').hidden, false);
  assert.equal(ui.node('empty-reward').hidden, true);
  await ui.click('signout-button');
  ui.release('/api/account/grain'); await flush();
  assert.equal(ui.node('empty-write').hidden, true);
  assert.equal(ui.node('empty-reward').hidden, true);
  assert.equal(ui.node('empty-signin').hidden, false);
});

test('경국지계 네 게시판의 타일과 정본 빈 문장을 제공하고 공지는 작성·보상을 숨김', async () => {
  const expected = {
    free: ['아직 고요합니다', '첫 이야기를 남겨 주세요.'],
    deck: ['아직 펼쳐진 덱이 없습니다', '당신의 첫 조합을 보여 주세요.'],
    strategy: ['아직 드러난 계략이 없습니다', '대전에서 찾은 한 수를 들려주세요.'],
    notice: ['새 소식을 준비하고 있습니다', '곧 천하의 소식을 전하겠습니다.'],
  };
  for (const [board, [title, description]] of Object.entries(expected)) {
    const ui = screen({ game: 'gyeongguk', board, user: member, noOfficial: board === 'notice' }); await flush();
    assert.equal(ui.node('empty-title').textContent, title);
    assert.equal(ui.node('empty-description').textContent, description);
    assert.equal(ui.node('empty-art').hidden, false);
    assert.equal(ui.node('empty-art').className, `empty-art tile-${board}`);
    assert.equal(ui.node('empty-image').src, undefined);
    assert.equal(ui.node('empty-write').hidden, board === 'notice');
    assert.equal(ui.node('empty-reward').hidden, board === 'notice');
    assert.ok(ui.node('board-tabs').children.some(tab => tab.href === `/community/?game=gyeongguk&board=${board}`));
  }
});

test('경국지계도 비회원·보상 미자격·검색 없음·연결 실패를 구분함', async () => {
  for (const board of ['free', 'deck', 'strategy']) {
    for (const eligibility of ['eligible', 'unverified', 'under14', 'suspended']) {
      const ui = screen({ game: 'gyeongguk', board, user: member, eligibility }); await flush();
      assert.equal(ui.node('empty-reward').hidden, eligibility !== 'eligible');
    }
    const guest = screen({ game: 'gyeongguk', board }); await flush();
    assert.equal(guest.node('empty-signin').hidden, false);
    assert.equal(guest.node('empty-signup').hidden, false);
    assert.equal(guest.node('empty-write').hidden, true);
  }
  for (const options of [{ query: '없는말' }, { fail: ['/api/community/posts'] }]) {
    const ui = screen({ game: 'gyeongguk', ...options }); await flush();
    assert.equal(ui.node('empty-art').hidden, true);
    assert.equal(ui.node('empty-reward').hidden, true);
    assert.equal(ui.node('empty-actions').hidden, true);
  }
});

test('게임 그림은 주소 없이 시작하고 머리말에서 테마를 먼저 확정함', async () => {
  const html = await readFile(new URL('../community/index.html', import.meta.url), 'utf8');
  const host = await readFile(new URL('../assets/community/host.js', import.meta.url), 'utf8');
  assert.ok(html.indexOf('/assets/community/host.js') < html.indexOf('rel="stylesheet"'));
  assert.doesNotMatch(html, /<img[^>]+(?:src|srcset)="[^\"]*(?:slimeline|gyeongguk|slime-front)/);
  for (const [query, game, color] of [['gyeongguk', 'gyeongguk', '#f8f6f1'], ['slimeline', 'slimeline', '#101728'], ['', 'picker', '#17131f'], ['__proto__', 'picker', '#17131f']]) {
    const root = { dataset: {} }, meta = {};
    runInNewContext(host, { document: { documentElement: root, querySelector: () => meta }, location: { pathname: '/community/', search: `?game=${query}`, hostname: '127.0.0.1' }, window: {}, URLSearchParams });
    assert.equal(root.dataset.game, game);
    assert.equal(meta.content, color);
  }
});


test('게임 선택 화면과 잘못된 게임 주소에서는 어느 게임 그림도 지정하지 않음', async () => {
  for (const game of ['', 'unknown', '__proto__']) {
    const ui = screen({ game }); await flush();
    assert.equal(ui.node('game-picker').hidden, false);
    assert.equal(ui.node('community-content').hidden, true);
    for (const id of ['game-hero-art', 'game-title', 'empty-image']) assert.equal(ui.node(id).src, undefined);
  }
});

test('공용 호스트 스크립트는 관리자·제보 페이지의 문서 테마를 건드리지 않음', async () => {
  const host = await readFile(new URL('../assets/community/host.js', import.meta.url), 'utf8');
  for (const pathname of ['/account/admin/', '/community/bug-report/']) {
    const window = {};
    runInNewContext(host, { location: { pathname, hostname: '127.0.0.1', search: '' }, window, URLSearchParams });
    assert.equal(window.gracekinCommunityRedirecting, false);
  }
});
