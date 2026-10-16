/* 상단 계정 표시는 서버 응답으로만 구성하며 페이지가 숨겨지면 개인 표시를 비웁니다. */
(() => {
  'use strict';
  const header = document.querySelector('[data-account-header]');
  if (!header) return;
  const link = header.querySelector('[data-account-link]');
  const label = header.querySelector('[data-account-label]');
  const grain = header.querySelector('[data-account-grain]');
  const balance = header.querySelector('[data-account-balance]');
  const retry = header.querySelector('[data-account-retry]');
  const params = new URLSearchParams(location.search);
  const pathGame = location.pathname.match(/^\/games\/(slimeline|gyeongguk)\//)?.[1];
  const game = pathGame || (['slimeline', 'gyeongguk'].includes(params.get('game')) ? params.get('game') : null);
  link.href = `/account/${game ? `?game=${game}` : ''}`;
  const pages = location.protocol === 'https:' && ['gracekingames.com', 'www.gracekingames.com'].includes(location.hostname);
  let generation = 0, controller = null, suspended = false;

  function clear(message = '내 계정', accessible = '내 계정 열기') {
    generation += 1;
    controller?.abort();
    controller = null;
    label.textContent = message;
    balance.textContent = '';
    grain.hidden = true;
    retry.hidden = true;
    link.setAttribute('aria-label', accessible);
    link.removeAttribute('title');
    header.setAttribute('aria-busy', 'false');
  }
  async function refresh() {
    clear('내 계정', '로그인 상태 확인 중, 내 계정 열기');
    if (document.hidden || suspended) return;
    const current = generation;
    const requestController = new AbortController();
    controller = requestController;
    const signal = requestController.signal;
    const timer = setTimeout(() => requestController.abort(), 12000);
    header.setAttribute('aria-busy', 'true');
    try {
      // 목적지는 두 고정 경로 중 하나로 제한합니다. 표시 요청에 별도 헤더를 붙이지 않습니다.
      const response = pages
        ? await fetch('https://community.gracekingames.com/api/account/summary', { credentials: 'include', cache: 'no-store', signal })
        : await fetch('/api/account/summary', { credentials: 'same-origin', cache: 'no-store', signal });
      if (!response.ok) throw new Error('계정 표시를 불러오지 못했습니다.');
      const data = await response.json();
      if (current !== generation || document.hidden || suspended) return;
      if (data.user === null) {
        label.textContent = '로그인';
        link.setAttribute('aria-label', '그레이스킨게임즈 계정 로그인');
        return;
      }
      const user = data.user;
      if (!user || typeof user.name !== 'string' || !user.name.trim() || !Number.isSafeInteger(user.grainBalance) || user.grainBalance < 0) throw new Error('계정 표시를 확인하지 못했습니다.');
      const amount = new Intl.NumberFormat('ko-KR').format(user.grainBalance);
      label.textContent = user.name;
      balance.textContent = `${amount} 그레인`;
      grain.hidden = false;
      link.setAttribute('aria-label', `${user.name}님, ${amount} 그레인, 내 계정 열기`);
      link.setAttribute('title', `${user.name} · ${amount} 그레인`);
    } catch (_) {
      if (current !== generation || document.hidden || suspended) return;
      label.textContent = '내 계정';
      balance.textContent = '';
      grain.hidden = true;
      retry.hidden = false;
      link.setAttribute('aria-label', '로그인 상태를 확인하지 못했어요. 내 계정 열기');
    } finally {
      clearTimeout(timer);
      if (current === generation) { controller = null; header.setAttribute('aria-busy', 'false'); }
    }
  }
  retry.addEventListener('click', refresh);
  window.addEventListener('pagehide', () => clear());
  window.addEventListener('pageshow', refresh);
  window.addEventListener('blur', () => clear());
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => document.hidden ? clear() : refresh());
  window.addEventListener('gracekin-account-change', event => {
    suspended = event.detail?.phase === 'clear';
    if (suspended) clear(); else refresh();
  });
  refresh();
})();
