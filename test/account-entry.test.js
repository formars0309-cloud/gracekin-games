import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../assets/account/entry.js', import.meta.url), 'utf8');
const ORIGIN = 'https://community.gracekingames.com';

function enter(url) {
  const current = new URL(url), actions = [], listeners = {};
  const window = { addEventListener: (name, callback) => { listeners[name] = callback; }, dispatchEvent: event => actions.push(['event', event.type]) };
  const location = { hostname: current.hostname, search: current.search, hash: current.hash, replace: destination => actions.push(['redirect', destination]) };
  const history = { replaceState: (_state, _title, path) => actions.push(['clean', path]) };
  runInNewContext(source, { window, location, history, URL, URLSearchParams, Event });
  return { window, actions, location, listeners };
}

test('Pages의 계정 진입은 인증값을 먼저 지우고 새 도메인의 해시로만 전달', () => {
  for (const host of ['gracekingames.com', 'www.gracekingames.com']) {
    for (const view of ['verify', 'reset']) {
      const { window, actions } = enter(`https://${host}/account/?view=${view}&game=slimeline&board=free&next=https://outside.example/#token=local-test-token`);
      assert.equal(window.gracekinAccountRedirecting, true);
      assert.equal(actions[0][0], 'clean');
      assert.doesNotMatch(actions[0][1], /token|outside/);
      const destination = new URL(actions[1][1]);
      assert.equal(actions[1][0], 'redirect');
      assert.equal(destination.origin, ORIGIN);
      assert.equal(destination.pathname, '/account/');
      assert.equal(destination.search, `?view=${view}&game=slimeline&board=free`);
      assert.equal(destination.hash, '#token=local-test-token');
      assert.equal(window.gracekinAccountEntry, undefined);
    }
  }
});

test('새 계정 출처에서는 메일 해시를 주소에서 지우고 인증 화면에만 전달', () => {
  const { window, actions, location, listeners } = enter(`${ORIGIN}/account/?view=verify#token=first-test-token`);
  assert.equal(window.gracekinAccountRedirecting, false);
  assert.equal(window.gracekinAccountEntry.token, 'first-test-token');
  assert.equal(window.gracekinAccountEntry.view, 'verify');
  assert.equal(actions.some(([kind]) => kind === 'redirect'), false);
  assert.equal(actions[0][1], '/account/?view=verify');
  location.search = '?view=reset';
  location.hash = '#token=second-test-token';
  listeners.hashchange();
  assert.equal(window.gracekinAccountEntry.token, 'second-test-token');
  assert.equal(window.gracekinAccountEntry.view, 'reset');
  assert.equal(actions.at(-2)[1], '/account/?view=reset');
});
