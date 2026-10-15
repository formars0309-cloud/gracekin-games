/* 인증 링크의 비밀값을 주소에서 즉시 지우고, 고정된 계정 서버에서만 처리한다. */
(() => {
  'use strict';
  const ACCOUNT_ORIGIN = 'https://gracekin-games-community.fly.dev';
  const params = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const token = fragment.get('token') || params.get('token') || '';
  const allowedViews = new Set(['signin', 'signup', 'forgot', 'reset', 'verify', 'guardian']);
  const view = allowedViews.has(params.get('view')) ? params.get('view') : 'signin';
  const clean = new URLSearchParams({ view });
  if (['slimeline', 'gyeongguk'].includes(params.get('game'))) clean.set('game', params.get('game'));
  if (['notice', 'free', 'guide', 'gallery', 'deck', 'strategy'].includes(params.get('board'))) clean.set('board', params.get('board'));
  if (params.get('error') === 'INVALID_TOKEN') clean.set('error', 'INVALID_TOKEN');
  history.replaceState(null, '', `/account/?${clean}`);
  const isPages = location.hostname === 'gracekingames.com' || location.hostname === 'www.gracekingames.com';
  window.gracekinAccountRedirecting = isPages;
  if (isPages) {
    const destination = new URL('/account/', ACCOUNT_ORIGIN);
    destination.search = clean.toString();
    if (token && ['reset', 'verify'].includes(view)) destination.hash = new URLSearchParams({ token }).toString();
    location.replace(destination.href);
    return;
  }
  window.gracekinAccountEntry = { view, token: ['reset', 'verify'].includes(view) ? token : '', params: clean };
})();
