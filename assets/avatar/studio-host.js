/* 계정 쿠키를 받은 호스트에서 편집과 저장을 함께 진행한다. */
if (['gracekingames.com', 'www.gracekingames.com'].includes(location.hostname)) {
  const workshop = new URL('/games/avatar/', 'https://community.gracekingames.com');
  if (location.hash === '#quiz' || new URLSearchParams(location.search).get('mode') === 'quiz') workshop.hash = 'quiz';
  location.replace(workshop.href);
}
