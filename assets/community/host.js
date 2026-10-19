/* 공개 커뮤니티의 출처를 고정하고, Pages에서는 회원 API를 시작하지 않는다. */
(() => {
  'use strict';
  // 본문을 해석하기 전에 게임과 브라우저 색을 확정한다.
  const requestedGame = new URLSearchParams(location.search).get('game');
  const game = ['slimeline', 'gyeongguk'].includes(requestedGame) ? requestedGame : 'picker';
  if (['/community/', '/community/index.html'].includes(location.pathname)) {
    document.documentElement.dataset.game = game;
    document.querySelector('meta[name="theme-color"]').content = game === 'gyeongguk' ? '#f8f6f1' : game === 'slimeline' ? '#101728' : '#17131f';
    if (game !== 'picker') {
      for (const name of ['hero.webp', 'title.png']) {
        const preload = document.createElement('link');
        preload.rel = 'preload';
        preload.as = 'image';
        preload.href = `/assets/${game}/${name}`;
        preload.setAttribute('fetchpriority', 'high');
        document.head.append(preload);
      }
    }
  }
  const COMMUNITY_ORIGIN = 'https://community.gracekingames.com';
  const isPages = location.hostname === 'gracekingames.com' || location.hostname === 'www.gracekingames.com';
  window.gracekinCommunityRedirecting = isPages;
  if (isPages) {
    const destination = new URL(COMMUNITY_ORIGIN);
    destination.pathname = location.pathname;
    destination.search = location.search;
    destination.hash = location.hash;
    location.replace(destination.href);
  }
})();
