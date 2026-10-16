/* 공개 커뮤니티의 출처를 고정하고, Pages에서는 회원 API를 시작하지 않는다. */
(() => {
  'use strict';
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
