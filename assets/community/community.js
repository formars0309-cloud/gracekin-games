/* 게임별 공식 안내와 게시판 주소를 한곳에서 관리한다. */
(() => {
  'use strict';
  if (window.gracekinCommunityRedirecting || location.hostname === 'gracekingames.com' || location.hostname === 'www.gracekingames.com') return;
  const studioPath = path => location.hostname === 'community.gracekingames.com' ? `https://gracekingames.com${path}` : path;
  for (const link of document.querySelectorAll('.studio-home-link')) link.href = studioPath('/');
  const FEEDBACK_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSezA52mxi13kKNyLORsFTjZGpxHa84rIzh7GVKfOthP6AI16w/viewform';
  const GAMES = {
    slimeline: {
      name: '슬라임 라인', home: '/games/slimeline/', privacy: 'https://slimeline.gracekingames.com/privacy.html',
      description: '작은 슬라임의 길에서 만난 이야기를 나누어요.',
      aside: '선을 그려 길을 잇는 슬라임 라인의 소식과 이용 안내예요.',
      boards: { free: ['자유 이야기', '슬라임과 함께한 순간과 일상의 이야기를 자유롭게 나누어요.'], guide: ['공략 나누기', '길을 잇는 작은 발견과 나만의 풀이를 함께 나누어요.'], gallery: ['작품 자랑', '슬라임을 좋아하는 마음으로 만든 작품과 모험의 추억을 소개해 주세요.'], notice: ['새 소식', '슬라임 라인의 새 소식과 게임 이용 안내를 확인하세요.'] },
      posts: [
        { id: 'welcome', date: '2026-10-15', cover: '/assets/slimeline/hero.webp', title: '슬라임 라인에 오신 것을 환영해요', excerpt: '선을 그려, 작은 슬라임의 다음 걸음을 이어 주세요.', sections: [
          ['작은 선에서 시작되는 모험', '슬라임 라인은 선을 그려 슬라임의 길을 만드는 퍼즐 게임이에요. 사계절 모험, 우리 마을과 봄 산책 섬을 만나 보세요.'],
          ['모험을 시작하려면', '슬라임 라인 홈페이지의 START를 누르면 게임으로 이동해요. 게임을 시작하기 전에 홈페이지에서 소개와 이용 안내를 살펴볼 수 있어요.'],
          ['이곳에서 만나요', '커뮤니티에서는 공식 소식과 이용 안내를 읽을 수 있어요. 글·댓글 작성이 가능한 계정으로 로그인하면 자유 이야기와 공략 나누기, 작품 자랑에서 이야기를 나눌 수 있어요. 버그·보안 문제는 비공개 버그 제보로 보내 주세요.']
        ] },
        { id: 'play-guide', date: '2026-10-15', cover: '/assets/slimeline/tiles.webp', title: '슬라임 라인, 처음 시작하는 분께', excerpt: '게임을 여는 방법과 문제가 생겼을 때 확인할 곳을 모았어요.', sections: [
          ['게임 홈페이지에서 START', '게임 홈페이지의 START를 누르면 슬라임 라인이 열려요. 설치 없이 브라우저에서 즐기는 게임이며, 현재 테스트 중이에요.'],
          ['선을 그려 길을 이어요', '슬라임이 지나갈 길을 선으로 만들어 주세요. 게임 화면에 나오는 안내를 보며 한 걸음씩 시작하면 돼요.'],
          ['막히거나 오류를 만났다면', '화면이 멈추거나 예상과 다르게 움직인다면 비공개 버그 제보로 알려 주세요. 이용한 기기와 브라우저, 문제가 생긴 화면과 상황을 함께 적어 주시면 확인에 도움이 돼요.']
        ] },
        { id: 'feedback', date: '2026-10-15', cover: '/assets/slime-front.png', title: '문제 신고와 소감을 보내는 방법', excerpt: '플레이하다 만난 문제나 떠오른 생각을 편지로 받습니다.', sections: [
          ['로그인한 계정으로 비공개 제보해요', '비공개 버그 제보에서 알려진 문제를 먼저 확인해 주세요. 로그인한 계정으로 제보하면 본인은 제보 목록과 처리 상태를 볼 수 있어요. 원문은 운영자만 확인해요.'],
          ['제보 전에 해 볼 것', '화면을 새로고침하고, 다른 브라우저에서도 같은 문제가 생기는지 살펴봐 주세요. 비공개 버그 제보의 알려진 문제도 확인해 주세요.'],
          ['문제 설명에 적을 칸', ['게임 이름: 슬라임 라인', '어느 화면: 문제가 생긴 화면과 주소', '무엇을 했는지: 문제가 반복되는 순서', '기대한 결과와 실제 결과: 각각 어떻게 달랐는지', '기기와 브라우저: 기기 이름, 운영체제, 브라우저 이름과 버전']],
          ['소감과 제안 보내기', '일반 의견은 아래 의견 보내기로 들려주세요. 버그·보안 문제는 비공개 버그 제보로 보내 주세요. 비밀번호·인증 코드·개인 키는 적지 마세요.'],
          ['다른 문의가 있다면', '이메일 문의는 support@gracekingames.com으로 보내 주세요.']
        ] },
        { id: 'rules', date: null, cover: '/assets/slimeline/tiles.webp', title: '커뮤니티 규칙 한 장', excerpt: '함께 이야기하기 전에 이용약관의 주요 내용을 살펴봐요.', sections: [
          ['서로를 지키며 이야기해요', ['도배와 무관한 광고·홍보를 올리지 않아요.', '욕설·협박·차별과 특정인을 괴롭히는 내용을 올리지 않아요.', '본인이나 다른 사람의 비밀번호·연락처 등 공개하면 안 되는 개인정보를 올리지 않아요.', '불법 정보나 타인의 권리를 침해하는 내용을 올리지 않아요.', '계정·그레인의 거래·대여·대리 이용과 외부 거래 알선 글을 올리지 않아요.', '버그·보안 취약점과 악용 방법은 공개 게시판에 쓰지 않고 비공개 버그 제보로 보내요.']],
          ['신고와 운영 조치', '게시물 신고 기능으로 대상과 사유를 알려 주세요. 운영자는 위반 내용·정도·반복 여부·피해를 확인해 게시물 숨김, 부당 획득 그레인 회수, 보상 정지, 일부 기능 또는 계정 이용 제한을 필요한 범위에서 적용해요. 피해 확산이나 보안상 긴급한 사유가 있으면 먼저 조치하고 뒤에 안내할 수 있어요.'],
          ['제재가 억울할 때', '조치 사유·종류·범위·기간과 이의 제기 방법은 계정 이메일이나 본인이 확인할 수 있는 화면으로 안내해요. support@gracekingames.com으로 대상 계정, 조치 내용과 이의 사유를 보내 재검토를 요청할 수 있어요. 운영자는 기록을 확인해 결과와 이유를 알리고, 처리가 길어지면 이유와 예상 일정을 안내해요. 잘못된 조치가 확인되면 해제·복구 등 필요한 정정을 해요.'],
          ['이용약관의 요약이에요', '이 안내는 커뮤니티 이용약관 5절과 9절의 요약이에요. 자세한 기준과 절차는 이용약관에서 확인해 주세요.']
        ] }
      ]
    },
    gyeongguk: {
      name: '경국지계', home: '/games/gyeongguk/', privacy: 'https://gyeongguk.gracekingames.com/privacy',
      description: '한 장의 계략, 한 판의 이야기가 모이는 곳.',
      aside: '미인과 계략의 삼국 카드 대전, 경국지계의 공식 소식과 이용 안내입니다.',
      boards: { free: ['자유 게시판', '한 판을 마친 소감과 다양한 이야기를 나누는 곳입니다.'], deck: ['덱 연구', '더 강한 한 수를 위해 카드 조합과 덱을 연구합니다.'], strategy: ['전략 이야기', '대전에서 찾은 수와 계략, 천하를 보는 또 다른 시선을 나눕니다.'], notice: ['새 소식', '경국지계의 공식 소식과 게임 이용 안내를 확인하세요.'] },
      posts: [
        { id: 'welcome', date: '2026-10-15', cover: '/assets/gyeongguk/hero.webp', title: '경국지계에 오신 것을 환영합니다', excerpt: '덮어 둔 카드 한 장이 판을 뒤집는 삼국 카드 대전.', sections: [
          ['미인과 계략의 삼국 카드 대전', '경국지계는 실시간 카드 대전 게임입니다. 게임 홈페이지에서 소개를 살펴보고 START를 눌러 대전에 들어가세요.'],
          ['현재는 테스트 기간입니다', '테스트 기간에는 전설을 포함한 모든 카드를 사용할 수 있습니다. 플레이 기록은 정식 시즌 전에 초기화될 수 있습니다.'],
          ['공식 소식과 이용 안내', '이곳에서는 공식 소식과 이용 안내를 읽을 수 있습니다. 글·댓글 작성이 가능한 계정으로 로그인하면 자유 게시판, 덱 연구, 전략 이야기에서 이야기를 나눌 수 있습니다. 버그·보안 문제는 비공개 버그 제보로 보내 주세요.']
        ] },
        { id: 'play-guide', date: '2026-10-15', cover: '/assets/gyeongguk/card-zhugeliang.webp', title: '경국지계, 대전에 들어가기 전에', excerpt: '게임 시작 방법과 테스트 기간의 이용 안내입니다.', sections: [
          ['게임 홈페이지에서 START', '경국지계 홈페이지의 START를 누르면 게임으로 이동합니다. 브라우저에서 설치 없이 시작할 수 있습니다.'],
          ['게임 안의 안내를 확인하세요', '게임에 들어가면 화면에 표시된 안내를 따라 진행하세요. 테스트 기간에는 전설을 포함한 모든 카드를 사용할 수 있으며, 기록은 정식 시즌 전에 초기화될 수 있습니다.'],
          ['플레이 중 도움이 필요하다면', '게임 안의 문제 신고와 소감 남기기로 의견을 보낼 수 있습니다. 버그는 비공개 버그 제보로, 일반 의견은 홈페이지의 의견 보내기로 보낼 수 있습니다.']
        ] },
        { id: 'feedback', date: '2026-10-15', cover: '/assets/gyeongguk/card-diaochan.webp', title: '문제 신고와 소감을 보내는 방법', excerpt: '대전 중 만난 문제와 카드에 대한 생각을 들려주세요.', sections: [
          ['게임 안에서 바로 보내기', '경국지계 안의 문제 신고와 소감 남기기를 이용할 수 있습니다. 문제가 생긴 상황과 화면을 함께 알려 주시면 확인에 도움이 됩니다.'],
          ['홈페이지에서 보내기', '비공개 버그 제보에서 알려진 문제를 확인하고 로그인한 계정으로 제보할 수 있습니다. 본인은 제보 목록과 처리 상태를 확인할 수 있고 원문은 운영자만 확인합니다. 게임 이름을 경국지계로 적어 주세요. 비밀번호나 인증 코드는 보내지 마세요.'],
          ['제보 전에 해 볼 것', '화면을 새로고침하고, 다른 브라우저에서도 같은 문제가 생기는지 확인합니다. 비공개 버그 제보의 알려진 문제도 확인합니다.'],
          ['문제 설명에 적을 칸', ['게임 이름: 경국지계', '어느 화면: 문제가 생긴 화면과 주소', '무엇을 했는지: 문제가 반복되는 순서', '기대한 결과와 실제 결과: 각각 어떻게 달랐는지', '기기와 브라우저: 기기 이름, 운영체제, 브라우저 이름과 버전']],
          ['소감과 제안 보내기', '일반 의견은 아래 의견 보내기로 보낼 수 있습니다. 버그·보안 문제는 비공개 버그 제보로 접수합니다. 비밀번호·인증 코드·개인 키는 적지 않습니다.'],
          ['이메일로 문의하기', '다른 문의는 support@gracekingames.com으로 보내 주세요.']
        ] },
        { id: 'rules', date: null, cover: '/assets/gyeongguk/tiles.webp', title: '커뮤니티 규칙 한 장', excerpt: '이용약관의 주요 내용과 이의 제기 절차를 안내합니다.', sections: [
          ['서로를 지키며 이야기합니다', ['도배와 무관한 광고·홍보를 게시하지 않습니다.', '욕설·협박·차별과 특정인을 괴롭히는 내용을 게시하지 않습니다.', '본인이나 다른 사람의 비밀번호·연락처 등 공개하면 안 되는 개인정보를 게시하지 않습니다.', '불법 정보나 타인의 권리를 침해하는 내용을 게시하지 않습니다.', '계정·그레인의 거래·대여·대리 이용과 외부 거래 알선 글을 게시하지 않습니다.', '버그·보안 취약점과 악용 방법은 공개 게시판에 쓰지 않고 비공개 버그 제보로 접수합니다.']],
          ['신고와 운영 조치', '게시물 신고 기능으로 대상과 사유를 알릴 수 있습니다. 운영자는 위반 내용·정도·반복 여부·피해를 확인해 게시물 숨김, 부당 획득 그레인 회수, 보상 정지, 일부 기능 또는 계정 이용 제한을 필요한 범위에서 적용합니다. 피해 확산이나 보안상 긴급한 사유가 있으면 먼저 조치하고 뒤에 안내할 수 있습니다.'],
          ['제재가 억울할 때', '조치 사유·종류·범위·기간과 이의 제기 방법은 계정 이메일이나 본인이 확인할 수 있는 화면으로 안내합니다. support@gracekingames.com으로 대상 계정, 조치 내용과 이의 사유를 보내 재검토를 요청할 수 있습니다. 운영자는 기록을 확인해 결과와 이유를 알리고, 처리가 길어지면 이유와 예상 일정을 안내합니다. 잘못된 조치가 확인되면 해제·복구 등 필요한 정정을 합니다.'],
          ['이용약관의 요약입니다', '이 안내는 커뮤니티 이용약관 5절과 9절의 요약입니다. 자세한 기준과 절차는 이용약관에서 확인할 수 있습니다.']
        ] }
      ]
    }
  };
  const params = new URLSearchParams(location.search);
  const gameId = params.get('game');
  const game = Object.prototype.hasOwnProperty.call(GAMES, gameId) ? GAMES[gameId] : null;
  const byId = id => document.getElementById(id);
  byId('home-link').href = studioPath('/');
  const make = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined && text !== null) element.textContent = text; if (className) element.className = className; return element; };
  if (!game) {
    byId('game-picker').hidden = false;
    byId('community-content').hidden = true;
    byId('game-privacy-link').hidden = true;
    // 게임을 고르기 전의 커뮤니티 진입도 로그인 회원의 하루 첫 출석에 포함한다.
    (async () => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const session = await fetch('/api/community/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!session.ok || !(await session.json()).user) return;
        const response = await fetch('/api/grain/attendance', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
        if (!response.ok) return; const result = await response.json();
        if (result.awarded) { const notice = make('p', `오늘 출석으로 ${new Intl.NumberFormat('ko-KR').format(result.amount)} 그레인을 받았어요.`, 'reward-notice'); notice.setAttribute('role', 'status'); byId('game-picker').prepend(notice); }
      } catch (_) { /* 게임 선택은 출석 응답과 관계없이 제공한다. */ }
      finally { clearTimeout(timer); }
    })();
    return;
  }
  const boardId = Object.prototype.hasOwnProperty.call(game.boards, params.get('board')) ? params.get('board') : 'notice';
  const query = (params.get('q') || '').slice(0, 80).trim();
  const pageNumber = Math.min(10000, Math.max(1, Number.parseInt(params.get('page'), 10) || 1));
  const requestedPost = params.get('post');
  const state = { user: null, sessionVersion: 0, rewardEligibility: null, rewardPolicy: null, emptyKind: null, reportTarget: null, reportBusy: false, draftOwnerId: null, postBusy: false, commentBusy: false, confirmBusy: false, currentPost: null, editorKey: null, editorOriginal: { title: '', body: '' }, deleteAction: null, loadVersion: 0, commentDrafts: new Map() };
  const url = (board, post, search = query, page = 1) => { const next = new URLSearchParams({ game: gameId, board }); if (post) next.set('post', post); if (search) next.set('q', search); if (page > 1) next.set('page', page); return `/community/?${next}`; };
  // 기존 안내의 날짜는 최초 추가 커밋 946ddf3(2026-10-15) 기준이다.
  // 새 규칙 글은 공개 전이므로 date를 비워 두고 실제 공개 때 확정한다.
  // 다음 단계의 서버 글도 같은 카드 형태로 변환해 이 함수에 합칠 수 있다.
  function newsItems(additionalItems = []) {
    const official = game.posts.map(post => ({ ...post, source: 'official', href: url('notice', post.id, '') }));
    return [...additionalItems, ...official].filter(item => item.date)
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  }
  function newsCard(item) {
    const card = make('a', null, 'news-card'); card.href = item.href;
    const cover = make('img'); cover.src = item.cover; cover.alt = ''; cover.width = 360; cover.height = 180; cover.loading = 'lazy';
    const copy = make('div', null, 'news-card-copy');
    const date = make('time', item.date); date.dateTime = item.date;
    copy.append(make('span', '공식 안내', 'post-badge'), date, make('h3', item.title));
    card.append(cover, copy); return card;
  }
  const message = (id, text) => { byId(id).textContent = text || ''; byId(id).hidden = !text; };
  const errorText = error => error && error.message ? error.message : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
  const showConnection = () => { byId('connection-status').hidden = false; byId('connection-message').textContent = '지금 커뮤니티에 연결할 수 없어요. 글이 저장되었다면 다시 등록하기 전에 목록을 확인해 주세요. 공식 안내는 계속 읽을 수 있어요.'; };
  const connectionRestored = () => { byId('connection-status').hidden = true; };
  const authMessages = {
    INVALID_EMAIL_OR_PASSWORD: '이메일과 비밀번호를 확인해 주세요.', INVALID_PASSWORD: '비밀번호를 확인해 주세요.', USER_NOT_FOUND: '이메일과 비밀번호를 확인해 주세요.',
    USER_ALREADY_EXISTS: '이미 가입된 이메일이에요. 로그인해 주세요.', USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '이미 가입된 이메일이에요. 로그인해 주세요.', INVALID_EMAIL: '이메일 주소를 확인해 주세요.',
    PASSWORD_TOO_SHORT: '비밀번호는 8자 이상으로 입력해 주세요.', PASSWORD_TOO_LONG: '비밀번호는 128자 이하로 입력해 주세요.', UNAUTHORIZED: '로그인이 필요해요. 입력한 내용은 그대로 남아 있어요.', FORBIDDEN: '이 내용을 변경할 권한이 없어요.', NOT_FOUND: '글을 찾을 수 없어요. 삭제되었거나 주소가 바뀌었을 수 있어요.'
  };
  async function request(path, options = {}) {
    const { background = false, ...fetchOptions } = options;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('올바르지 않은 요청이에요.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(`/api${path}`, { ...fetchOptions, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: controller.signal });
    } catch (_) {
      if (!background) showConnection();
      throw new Error('연결이 끊겼거나 응답이 늦어지고 있어요. 입력한 내용은 남아 있어요. 다시 등록하기 전에 목록을 확인해 주세요.');
    } finally { clearTimeout(timer); }
    let data;
    try { data = await response.json(); } catch (_) { if (!background) showConnection(); throw new Error('커뮤니티 연결을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) {
      const detail = data.error || data;
      const error = new Error(response.status === 429 ? '요청이 많아요. 잠시 쉬었다 다시 시도해 주세요.' : authMessages[detail.code] || (/[가-힣]/.test(detail.message || '') ? detail.message : '요청을 처리하지 못했어요. 입력한 내용을 확인해 주세요.'));
      error.status = response.status;
      if (!background && response.status === 401) { state.user = null; renderSession(); }
      if (!background && response.status >= 500) showConnection();
      throw error;
    }
    if (!background) connectionRestored();
    return data;
  }
  const rewardNotice = make('p', '', 'reward-notice'); rewardNotice.hidden = true; rewardNotice.setAttribute('role', 'status'); rewardNotice.setAttribute('aria-live', 'polite');
  byId('community-content').prepend(rewardNotice);
  const showReward = text => { rewardNotice.textContent = text; rewardNotice.hidden = !text; };
  const reportDialog = make('dialog', null, 'community-dialog'); reportDialog.id = 'report-dialog'; reportDialog.setAttribute('aria-labelledby', 'report-title');
  const reportForm = make('form', null, 'dialog-form');
  const reportHeading = make('div', null, 'dialog-heading'); const reportTitle = make('h2', '글·댓글 신고'); reportTitle.id = 'report-title';
  const reportClose = make('button', '×', 'dialog-close'); reportClose.type = 'button'; reportClose.setAttribute('aria-label', '신고 창 닫기'); reportClose.addEventListener('click', () => { if (!state.reportBusy) reportDialog.close(); }); reportHeading.append(reportTitle, reportClose);
  const reasonField = make('div', null, 'form-field'); const reasonLabel = make('label', '신고 사유'); reasonLabel.htmlFor = 'report-reason'; const reasonSelect = make('select'); reasonSelect.id = 'report-reason'; reasonSelect.required = true;
  for (const reason of ['도배·광고', '욕설·괴롭힘', '개인정보 노출', '계정·그레인 거래', '버그·보안 제보 공개', '기타']) { const option = make('option', reason); option.value = reason; reasonSelect.append(option); } reasonField.append(reasonLabel, reasonSelect);
  const detailField = make('div', null, 'form-field'); const detailLabel = make('label', '추가 설명 (선택, 최대 500자)'); detailLabel.htmlFor = 'report-description'; const reportDescription = make('textarea'); reportDescription.id = 'report-description'; reportDescription.maxLength = 500; reportDescription.rows = 4; detailField.append(detailLabel, reportDescription);
  const reportResult = make('p', '', 'form-message'); reportResult.setAttribute('role', 'status'); reportResult.hidden = true;
  const reportSubmit = make('button', '신고 접수', 'primary-button'); reportSubmit.type = 'submit'; reportForm.append(reportHeading, make('p', '신고는 운영자만 확인해요. 비밀번호·인증 코드와 불필요한 개인정보는 적지 마세요.', 'dialog-description'), reasonField, detailField, reportResult, reportSubmit); reportDialog.append(reportForm); document.body.append(reportDialog);
  reportDialog.addEventListener('cancel', event => { if (state.reportBusy) event.preventDefault(); });
  function reportButton(type, item) {
    if (!state.user?.canWriteCommunity || item.author.id === state.user.id) return null;
    const button = make('button', '신고', 'quiet-button report-button'); button.type = 'button'; button.addEventListener('click', () => { state.reportTarget = { targetType: type, targetId: item.id }; reportDescription.value = ''; reportResult.hidden = true; reportSubmit.hidden = false; reportTitle.textContent = type === 'post' ? '글 신고' : '댓글 신고'; reportDialog.showModal(); reasonSelect.focus(); }); return button;
  }
  reportForm.addEventListener('submit', async event => {
    event.preventDefault(); if (state.reportBusy || !state.reportTarget || !reportForm.reportValidity()) return;
    state.reportBusy = true; busy(reportForm, true); reasonSelect.disabled = true; reportResult.hidden = true;
    try { await send('/community/reports', 'POST', { ...state.reportTarget, reason: reasonSelect.value, description: reportDescription.value.trim() }); reportResult.textContent = '신고를 접수했어요. 운영자가 확인할게요.'; reportResult.hidden = false; reportSubmit.hidden = true; }
    catch (error) { reportResult.textContent = errorText(error); reportResult.hidden = false; }
    finally { state.reportBusy = false; busy(reportForm, false); reasonSelect.disabled = false; }
  });
  const send = (path, method, data) => request(path, { method, body: JSON.stringify(data || {}) });
  const formatDate = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date); };
  function busy(form, value) { for (const control of form.querySelectorAll('button,input,textarea')) control.disabled = value; form.setAttribute('aria-busy', String(value)); }
  function openDialog(id) { const dialog = byId(id); if (!dialog.open) dialog.showModal(); }
  function renderSession() {
    byId('member-bar').hidden = !!state.user;
    byId('session-label').textContent = '로그인하면 글·댓글을 남기고 그레인을 받을 수 있어요.';
    byId('open-signin').hidden = !!state.user;
    byId('open-signup').hidden = !!state.user;
    byId('signout-button').hidden = !state.user;
    byId('comment-form').hidden = !state.user?.canWriteCommunity;
    byId('comment-restricted').hidden = !state.user || !!state.user.canWriteCommunity;
    byId('account-permission').hidden = !state.user || !!state.user.canWriteCommunity;
    byId('write-post').hidden = boardId === 'notice' || !!(state.user && !state.user.canWriteCommunity);
    byId('comment-login').hidden = !!state.user;
    renderEmptyAudience();
  }
  function clearDrafts() {
    state.editorKey = null; state.editorOriginal = { title: '', body: '' }; state.commentDrafts.clear();
    byId('post-title').value = ''; byId('post-body').value = ''; byId('comment-body').value = '';
    message('editor-error', ''); message('comment-error', '');
    if (byId('editor-dialog').open) byId('editor-dialog').close();
    if (byId('confirm-dialog').open) byId('confirm-dialog').close();
    state.deleteAction = null;
    if (state.currentPost && state.comments) renderComments(state.comments);
  }
  async function loadSession() {
    const version = ++state.sessionVersion;
    state.rewardEligibility = null;
    renderEmptyAudience();
    try {
      const data = await request('/community/session');
      if (version !== state.sessionVersion) return;
      const nextUser = data.user || null;
      const changedOwner = nextUser && state.draftOwnerId && String(nextUser.id) !== String(state.draftOwnerId);
      state.user = nextUser;
      if (changedOwner) clearDrafts();
      if (nextUser) state.draftOwnerId = nextUser.id;
      renderSession();
      if (nextUser) {
        await Promise.all([
          (async () => {
            try {
              const grain = await request('/account/grain', { background: true });
              if (version !== state.sessionVersion || state.user?.id !== nextUser.id) return;
              state.rewardEligibility = grain.rewardEligibility;
              renderEmptyAudience();
            } catch (_) { /* 자격을 확인하지 못했으면 보상 약속을 표시하지 않는다. */ }
          })(),
          (async () => {
            try { const result = await send('/grain/attendance', 'POST', {}); if (version === state.sessionVersion && result.awarded) showReward(`오늘 출석으로 ${new Intl.NumberFormat('ko-KR').format(result.amount)} 그레인을 받았어요.`); }
            catch (_) { /* 출석 실패가 게시판 이용을 막지 않는다. */ }
          })()
        ]);
      }
    }
    catch (_) {
      if (version !== state.sessionVersion) return;
      state.user = null; state.rewardEligibility = null; renderSession(); byId('session-label').textContent = '로그인 상태를 확인할 수 없어요.';
    }
  }
  function showAuth(mode = 'signin') {
    location.href = `/account/?${new URLSearchParams({ view: mode, game: gameId, board: boardId })}`;
  }
  byId('open-signin').addEventListener('click', () => showAuth());
  byId('open-signup').addEventListener('click', () => showAuth('signup'));
  byId('comment-open-signin').addEventListener('click', () => showAuth());
  byId('signout-button').addEventListener('click', async () => {
    const button = byId('signout-button'); if (button.disabled) return; button.disabled = true;
    window.dispatchEvent(new CustomEvent('gracekin-account-change', { detail: { phase: 'clear' } }));
    try { await send('/auth/sign-out', 'POST'); state.sessionVersion++; state.rewardEligibility = null; state.user = null; state.draftOwnerId = null; showReward(''); reportDialog.close(); clearDrafts(); renderSession(); await loadCurrent(); }
    catch (error) { showConnection(); byId('connection-message').textContent = errorText(error); }
    finally { button.disabled = false; window.dispatchEvent(new CustomEvent('gracekin-account-change', { detail: { phase: 'refresh' } })); }
  });
  document.body.dataset.game = gameId;
  byId('game-eyebrow').hidden = true;
  const heroArt = byId('game-hero-art');
  heroArt.width = gameId === 'slimeline' ? 1736 : 1756;
  heroArt.height = gameId === 'slimeline' ? 906 : 896;
  heroArt.alt = gameId === 'slimeline' ? '달빛 마을의 돌다리를 함께 걷는 분홍·하늘·노랑·연두 슬라임' : '매화와 산수 풍경을 배경으로 함께 선 여포와 초선';
  heroArt.setAttribute('fetchpriority', 'high');
  heroArt.src = `/assets/${gameId}/hero.webp`;
  heroArt.hidden = false;
  const titleArt = byId('game-title');
  titleArt.width = gameId === 'slimeline' ? 2171 : 2048;
  titleArt.height = gameId === 'slimeline' ? 724 : 768;
  titleArt.alt = game.name;
  titleArt.src = `/assets/${gameId}/title.png`;
  titleArt.hidden = false;
  byId('hero-links').hidden = false;
  byId('hero-home').href = studioPath(game.home);
  byId('hero-start').href = `https://${gameId}.gracekingames.com/`;
  byId('hero-start').setAttribute('data-umami-event', `play-${gameId}`);
  if (gameId === 'gyeongguk') byId('hero-links').prepend(byId('hero-start'));
  byId('board-group-title').textContent = gameId === 'gyeongguk' ? '천하의 이야기' : '우리들의 이야기';
  byId('hero-description').textContent = game.description;
  byId('aside-description').textContent = game.aside;
  byId('home-link').href = studioPath(game.home);
  byId('privacy-link').href = '/community/privacy/';
  byId('game-privacy-link').href = game.privacy;
  byId('game-privacy-link').hidden = false;
  byId('article-home').href = studioPath(game.home);
  byId('article-feedback').href = FEEDBACK_URL;
  byId('connection-notice').href = url('notice', null, '');
  byId('rules-link').href = url('notice', 'rules', '');
  for (const targetId of ['gyeongguk', 'slimeline']) {
    const target = GAMES[targetId];
    const link = make('a');
    link.href = `/community/?${new URLSearchParams({ game: targetId, board: target.boards[boardId] ? boardId : 'notice' })}`;
    if (targetId === gameId) link.setAttribute('aria-current', 'page');
    // 두 게임의 성과 슬라임을 선 그림으로 표시해 반대 게임 자산을 요청하지 않는다.
    const picture = make('span', null, `switch-picture switch-${targetId}`); picture.setAttribute('aria-hidden', 'true');
    picture.innerHTML = targetId === 'gyeongguk'
      ? '<svg viewBox="0 0 32 32" focusable="false"><path d="M4 28V13h7v15m10 0V13h7v15M2 13l5-7 6 7m6 0 6-7 5 7M11 28V18h10v10M11 18l5-8 5 8M16 10V3h6l-2 2 2 2h-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 32 32" focusable="false"><path d="M4 22C4 10 11 5 16 5s12 5 12 17c0 5-6 6-12 6S4 27 4 22Z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="11" cy="17" r="1.5" fill="currentColor"/><circle cx="21" cy="17" r="1.5" fill="currentColor"/><path d="M13 21q3 3 6 0" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    link.append(picture, make('span', target.name)); byId('game-switcher').append(link);
  }
  const firstVisit = byId('first-visit');
  const firstNews = make('a', '새 소식'); firstNews.href = url('notice', null, '');
  const firstFree = make('a', game.boards.free[0]); firstFree.href = url('free', null, '');
  const firstBug = make('a', '버그 제보'); firstBug.href = '/community/bug-report/';
  firstVisit.append(make('span', '처음이라면 '), firstNews, make('span', '부터, 한 판 소감은 '), firstFree, make('span', '에, 문제는 '), firstBug, make('span', gameId === 'gyeongguk' ? '로 전합니다.' : '로 알려 주세요.'));
  firstVisit.hidden = false;
  const shortcuts = [
    ['출석 / 그레인', '/account/', 'M5 4h14v16H5z M8 2v4 M16 2v4 M5 9h14 M8 14l3 3 5-6'],
    ['게임 시작', `https://${gameId}.gracekingames.com/`, 'M8 4l12 8-12 8z'],
    ['버그 제보', '/community/bug-report/', 'M12 4v9 M12 17v1 M12 2L2 21h20z'],
    ['의견 보내기', FEEDBACK_URL, 'M3 5h18v14H3z M3 5l9 8 9-8']
  ];
  for (const [label, href, path] of shortcuts) {
    const link = make('a'); link.href = href;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    // 고정된 선 그림만 사용한다.
    icon.innerHTML = `<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (href === FEEDBACK_URL) link.setAttribute('data-umami-event', 'feedback-form');
    if (label === '게임 시작') link.setAttribute('data-umami-event', `play-${gameId}`);
    link.append(icon, make('span', label)); byId('quick-links').append(link);
  }
  const recentNews = newsItems();
  if (boardId !== 'notice' && !requestedPost && recentNews.length) {
    byId('latest-news').hidden = false;
    for (const item of recentNews) byId('news-cards').append(newsCard(item));
  }
  for (const id of ['notice', ...Object.keys(game.boards).filter(id => id !== 'notice')]) {
    const [label] = game.boards[id];
    const tab = make('a'); tab.append(gameId === 'slimeline' ? boardIcon(id) : boardTile(id)); tab.append(make('span', label)); tab.href = url(id, null, ''); if (id === boardId) tab.setAttribute('aria-current', 'page'); byId('board-tabs').append(tab);
  }
  // 이미 보이는 탭은 움직이지 않고, 오른쪽에 가려진 선택 탭만 안쪽으로 옮긴다.
  const boardTabs = byId('board-tabs');
  const activeTab = boardTabs.querySelector('[aria-current="page"]');
  if (activeTab) {
    const rightEdge = activeTab.offsetLeft - boardTabs.offsetLeft + activeTab.offsetWidth;
    if (rightEdge > boardTabs.clientWidth) boardTabs.scrollLeft = rightEdge - boardTabs.clientWidth + 8;
  }
  const [boardTitle, boardDescription] = game.boards[boardId];
  byId('board-title').textContent = boardTitle;
  byId('board-description').textContent = boardDescription;
  byId('search-input').value = query;
  byId('write-post').hidden = boardId === 'notice';
  byId('gallery-notice').hidden = gameId !== 'slimeline' || boardId !== 'gallery';
  byId('board-help').textContent = '';
  byId('search-form').addEventListener('submit', event => { event.preventDefault(); location.href = url(boardId, null, byId('search-input').value.trim()); });
  byId('back-to-board').href = url(boardId, null, query, pageNumber);
  byId('retry-connection').addEventListener('click', async () => { byId('retry-connection').disabled = true; try { await Promise.all([loadSession(), loadCurrent(), loadGuidance()]); } finally { byId('retry-connection').disabled = false; } });
  function boardTile(id) {
    const tile = make('span', null, `board-tile tile-${id}`);
    tile.setAttribute('aria-hidden', 'true');
    return tile;
  }
  function boardIcon(id) {
    const paths = {
      free: '<path d="M29 14c0 8-7 12-15 12l-8 4 1-7C3 21 2 18 2 14 2 6 8 2 16 2s13 4 13 12Z" fill="currentColor"/><circle cx="10" cy="14" r="1.5" fill="var(--tab-cutout,var(--surface))"/><circle cx="16" cy="14" r="1.5" fill="var(--tab-cutout,var(--surface))"/><circle cx="22" cy="14" r="1.5" fill="var(--tab-cutout,var(--surface))"/>',
      guide: '<path d="M16 6C12 3 7 3 2 5v23c6-2 10-2 14 0 4-2 8-2 14 0V5c-5-2-10-2-14 1Z" fill="currentColor"/><path d="M16 7v19M6 9c3-1 5 0 7 1M6 14c3-1 5 0 7 1M19 10c2-1 4-2 7-1M19 15c2-1 4-2 7-1" fill="none" stroke="var(--tab-cutout,var(--surface))" stroke-width="1.4"/>',
      gallery: '<path d="M4 9h5l3-5h8l3 5h5c2 0 3 2 3 4v14c0 2-1 3-3 3H4c-2 0-3-1-3-3V13c0-2 1-4 3-4Z" fill="currentColor"/><circle cx="16" cy="19" r="7" fill="var(--tab-cutout,var(--surface))"/><circle cx="16" cy="19" r="4.5" fill="currentColor"/><circle cx="26" cy="13" r="1.5" fill="var(--tab-cutout,var(--surface))"/>',
      notice: '<path d="M16 29V14M16 20C4 20 3 8 3 8s12-1 13 12ZM16 15C16 4 29 3 29 3s1 13-13 12Z" fill="currentColor"/><path d="m10 13 6 7 6-12" fill="none" stroke="var(--tab-cutout,var(--surface))" stroke-width="1"/>'
    };
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 32 32'); icon.setAttribute('class', 'board-icon'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    // 게시판별 고정 도형만 사용하며 서버·사용자 입력을 넣지 않는다.
    icon.innerHTML = paths[id];
    return icon;
  }
  const number = value => new Intl.NumberFormat('ko-KR').format(value);
  function rewardActivity() {
    const activity = state.rewardPolicy?.activity;
    const values = [activity?.attendance?.amount, activity?.post?.amount, activity?.post?.dailyLimit, activity?.post?.minBodyLength, activity?.comment?.amount, activity?.confirmationDelayMs];
    return values.every(value => Number.isSafeInteger(value) && value > 0) ? activity : null;
  }
  function rewardText(kind) {
    const activity = rewardActivity();
    if (!activity || !state.user?.canWriteCommunity || state.rewardEligibility !== 'eligible') return '';
    return `${kind === 'post' ? '글을 쓰면' : '댓글을 쓰면'} ${number(activity.confirmationDelayMs / 3600000)}시간 뒤 ${number(activity[kind].amount)} 그레인이 적립돼요.`;
  }
  async function loadGuidance() {
    await Promise.all([
      (async () => {
        try {
          const config = await request('/account/config', { background: true }); state.rewardPolicy = config.grainRewardPolicy;
        } catch (_) { state.rewardPolicy = null; }
        const activity = rewardActivity();
        byId('grain-policy-summary').replaceChildren(); byId('grain-policy-summary').hidden = !activity;
        byId('grain-policy-status').hidden = !!activity;
        byId('grain-policy-status').textContent = activity ? '' : '받는 방법을 불러오지 못했어요. 계정 페이지에서 다시 확인해 주세요.';
        byId('grain-policy-delay').hidden = !activity;
        if (activity) {
          for (const [key, label] of [['attendance', '출석'], ['post', '글 작성'], ['comment', '댓글 작성']]) byId('grain-policy-summary').append(make('dt', label), make('dd', `${number(activity[key].amount)} 그레인`));
          byId('grain-policy-delay').textContent = `보상 자격과 지급 조건을 충족하면 받을 수 있어요. 글·댓글은 ${number(activity.confirmationDelayMs / 3600000)}시간 뒤 확인해요.`;
        }
        renderEmptyAudience();
      })(),
      (async () => {
        try {
          // 현재 공개 API에는 게임 필터가 없으므로 전체 게임 수임을 명시한다.
          const data = await request('/community/known-issues', { background: true });
          if (!Array.isArray(data.issues)) throw new Error('문제 목록 형식 오류');
          byId('known-issues-count').textContent = `알려진 문제 ${number(data.issues.length)}개 · 전체 게임`;
        } catch (_) { byId('known-issues-count').textContent = '알려진 문제 수를 확인하지 못했어요'; }
      })()
    ]);
  }
  function renderEmptyAudience() {
    const isBoardEmpty = state.emptyKind === 'board';
    const emptyArt = byId('empty-art');
    emptyArt.hidden = !isBoardEmpty;
    if (isBoardEmpty) {
      if (gameId === 'slimeline') { byId('empty-image').src = '/assets/slime-front.png'; byId('empty-image').hidden = false; }
      else {
        emptyArt.className = `empty-art tile-${boardId}`;
      }
    }
    byId('empty-actions').hidden = !isBoardEmpty;
    byId('empty-write').hidden = !isBoardEmpty || boardId === 'notice' || !state.user?.canWriteCommunity;
    byId('empty-signin').hidden = !isBoardEmpty || !!state.user;
    byId('empty-signup').hidden = !isBoardEmpty || !!state.user;
    const reward = isBoardEmpty && boardId !== 'notice' ? rewardText('post') : '';
    const activity = rewardActivity();
    byId('empty-reward').textContent = reward ? `${reward} 본문 ${number(activity.post.minBodyLength)}자 이상·하루 ${number(activity.post.dailyLimit)}회 등 지급 조건이 있어요.` : '';
    byId('empty-reward').hidden = !reward;
  }
  byId('empty-write').addEventListener('click', () => openEditor());
  byId('empty-signin').addEventListener('click', () => showAuth());
  byId('empty-signup').addEventListener('click', () => showAuth('signup'));
  function empty(title, description, href = url('notice', null, ''), label = '공식 안내 보기', kind = 'other') {
    state.emptyKind = kind;
    byId('empty-state').hidden = false; byId('empty-title').textContent = title; byId('empty-description').textContent = description; byId('empty-link').href = href; byId('empty-link').textContent = label;
    renderEmptyAudience();
  }
  function emptyBoard() {
    const descriptions = gameId === 'slimeline' ? {
      free: '아직 조용해요. 첫 이야기를 남겨 주세요.',
      guide: '작은 발견도 좋은 공략이 돼요. 나만의 풀이를 나눠 주세요.',
      gallery: '슬라임을 향한 마음을 담은 첫 작품을 글로 소개해 주세요.'
    } : {};
    const gyeonggukEmpty = {
      free: ['아직 고요합니다', '첫 이야기를 남겨 주세요.'],
      deck: ['아직 펼쳐진 덱이 없습니다', '당신의 첫 조합을 보여 주세요.'],
      strategy: ['아직 드러난 계략이 없습니다', '대전에서 찾은 한 수를 들려주세요.'],
      notice: ['새 소식을 준비하고 있습니다', '곧 천하의 소식을 전하겠습니다.']
    };
    const [title, description] = gameId === 'gyeongguk' ? gyeonggukEmpty[boardId] : [`${boardTitle}의 첫 글을 기다려요`, descriptions[boardId]];
    empty(title, description, url('notice', null, ''), `${game.boards.notice[0]} 보기`, 'board');
  }

  function row(item, official = false) {
    const link = make('a', null, 'post-row'); link.href = url(boardId, item.id, query, pageNumber);
    const meta = make('div', null, 'post-meta'); meta.append(make('span', official ? '공식 안내' : boardTitle, 'post-badge'), make('span', official ? '그레이스킨 게임즈' : item.author.name));
    if (official) { const date = make(item.date ? 'time' : 'span', item.date || '공개 전 초안'); if (item.date) date.dateTime = item.date; meta.append(date); }
    else meta.append(make('span', formatDate(item.createdAt)));
    link.append(meta, make('h3', item.title), make('p', official ? item.excerpt : item.body.replace(/\s+/g, ' ').slice(0, 160)));
    if (!official) link.append(make('span', `댓글 ${item.commentCount || 0}`, 'comment-count'));
    return link;
  }
  function validatePost(post, expectedBoard = boardId) {
    if (!post || post.game !== gameId || post.board !== expectedBoard || expectedBoard === 'notice' || !game.boards[post.board] || !post.author || typeof post.title !== 'string' || typeof post.body !== 'string') throw new Error('이 게시판의 글을 찾을 수 없어요. 목록으로 돌아가 주세요.');
  }
  function pagination(data) {
    const nav = byId('pagination'); nav.replaceChildren();
    const totalPages = Math.ceil(data.total / data.pageSize);
    if (totalPages < 2) { nav.hidden = true; return; }
    nav.hidden = false;
    const current = data.page;
    if (current > 1) { const previous = make('a', '← 이전'); previous.href = url(boardId, null, query, current - 1); nav.append(previous); }
    nav.append(make('span', `${current} / ${totalPages}`, 'page-position'));
    if (current < totalPages) { const next = make('a', '다음 →'); next.href = url(boardId, null, query, current + 1); nav.append(next); }
  }
  function showOfficial(post) {
    document.title = `${post.title} · ${game.name} 커뮤니티`;
    byId('board-view').hidden = true; byId('article-view').hidden = false;
    byId('article-title').textContent = post.title; byId('article-badge').textContent = '공식 안내'; byId('article-author').textContent = `그레이스킨 게임즈 · ${post.date || '공개 전 초안'}`;
    for (const [heading, body] of post.sections) {
      byId('article-body').append(make('h3', heading));
      if (Array.isArray(body)) { const list = make('ul'); for (const text of body) list.append(make('li', text)); byId('article-body').append(list); }
      else byId('article-body').append(make('p', body));
    }
    const links = make('p', null, 'official-links');
    for (const [text, href] of post.id === 'rules' ? [['이용약관 5절 · 커뮤니티 이용과 신고', '/community/terms/#community'], ['이용약관 9절 · 운영 조치와 이의 제기', '/community/terms/#restrictions'], ['이의 제기 메일 보내기', 'mailto:support@gracekingames.com']] : [['비공개 버그 제보', '/community/bug-report/'], ['알려진 문제 확인', '/community/bug-report/#known-issues']]) {
      const link = make('a', text); link.href = href; links.append(link);
    }
    byId('article-body').append(links);
  }
  async function loadCurrent() {
    const version = ++state.loadVersion;
    state.emptyKind = null; renderEmptyAudience();
    byId('post-list').replaceChildren(); byId('pagination').hidden = true; byId('empty-state').hidden = true;
    byId('article-body').replaceChildren(); byId('post-owner-actions').hidden = true; byId('comments-section').hidden = true; byId('article-actions').hidden = false;
    document.querySelectorAll('.post-report-button').forEach(node => node.remove());
    state.currentPost = null; message('article-status', '');
    if (boardId === 'notice') {
      const post = game.posts.find(item => item.id === requestedPost);
      if (post) { showOfficial(post); return; }
      byId('board-view').hidden = false; byId('article-view').hidden = true;
      document.title = `${boardTitle} · ${game.name} 커뮤니티`;
      if (requestedPost) { empty('이 안내를 찾을 수 없어요', '공식 안내 목록에서 찾으시는 내용을 확인해 주세요.'); return; }
      const needle = query.toLocaleLowerCase('ko');
      const posts = game.posts.filter(item => [item.title, item.excerpt, ...item.sections.flat()].join(' ').toLocaleLowerCase('ko').includes(needle));
      byId('result-count').textContent = query ? `검색 결과 ${posts.length}개` : `공식 안내 ${posts.length}개`;
      // 새 소식 탭은 같은 글을 카드와 목록에 중복으로 놓지 않는다. 검색은 전체 글을 대상으로 한다.
      const cards = make('div', null, 'news-cards'); cards.tabIndex = 0; cards.setAttribute('role', 'region'); cards.setAttribute('aria-label', '최근 새 소식 카드, 가로로 넘겨 보기');
      if (!query) for (const item of recentNews) cards.append(newsCard(item));
      if (cards.children.length) byId('post-list').append(cards);
      for (const item of posts) if (query || !recentNews.some(news => news.id === item.id)) byId('post-list').append(row(item, true));
      if (!posts.length) {
        if (!query && gameId === 'gyeongguk') emptyBoard();
        else empty('검색 결과가 없어요', '다른 검색어를 입력하거나 공식 안내를 살펴보세요.');
      }
      return;
    }
    byId('list-status').hidden = false; byId('board-view').hidden = false; byId('article-view').hidden = true;
    document.title = `${boardTitle} · ${game.name} 커뮤니티`;
    try {
      if (requestedPost) {
        const data = await request(`/community/posts/${encodeURIComponent(requestedPost)}?game=${encodeURIComponent(gameId)}`);
        if (version !== state.loadVersion) return;
        validatePost(data.post);
        if (!Array.isArray(data.comments)) throw new Error('댓글 정보를 확인할 수 없어요. 다시 시도해 주세요.');
        showMemberPost(data.post, data.comments);
      } else {
        const search = new URLSearchParams({ game: gameId, board: boardId, q: query, page: String(pageNumber) });
        const data = await request(`/community/posts?${search}`);
        if (version !== state.loadVersion) return;
        if (!Array.isArray(data.posts) || !Number.isFinite(data.total) || !(data.pageSize > 0)) throw new Error('글 목록을 확인할 수 없어요. 다시 시도해 주세요.');
        for (const item of data.posts) { validatePost(item); byId('post-list').append(row(item)); }
        byId('result-count').textContent = query ? `검색 결과 ${data.total}개` : `글 ${data.total}개`;
        pagination(data);
        if (!data.posts.length) {
          if (query) empty('검색 결과가 없어요', '다른 검색어를 입력하거나 게시판 목록을 확인해 보세요.', url(boardId, null, ''), '검색 지우고 목록 보기');
          else if (data.total === 0) emptyBoard();
          else empty('이 페이지에는 글이 없어요', '앞 페이지에서 이야기를 확인해 주세요.', url(boardId, null, '', 1), '첫 페이지 보기');
        }
      }
    } catch (error) {
      if (version !== state.loadVersion) return;
      byId('result-count').textContent = '';
      empty(requestedPost ? '글을 열 수 없어요' : '이야기를 불러오지 못했어요', errorText(error));
    } finally { if (version === state.loadVersion) byId('list-status').hidden = true; }
  }
  function showMemberPost(post, comments) {
    state.currentPost = post; state.comments = comments;
    document.title = `${post.title} · ${game.name} 커뮤니티`;
    byId('board-view').hidden = true; byId('article-view').hidden = false;
    byId('article-title').textContent = post.title; byId('article-badge').textContent = boardTitle;
    byId('article-author').textContent = `${post.author.name} · ${formatDate(post.createdAt)}${post.updatedAt !== post.createdAt ? ' · 수정됨' : ''}`;
    byId('article-body').append(make('p', post.body, 'member-body'));
    byId('post-owner-actions').hidden = !(state.user?.canWriteCommunity && post.canEdit);
    byId('comments-section').hidden = false;
    byId('comments-title').textContent = `댓글 ${comments.length}`;
    const report = reportButton('post', post); if (report) { report.classList.add('post-report-button'); byId('article-actions').append(report); }
    renderComments(comments); renderSession();
  }
  function renderComments(comments) {
    const list = byId('comment-list'); list.replaceChildren(); byId('comment-empty').hidden = comments.length > 0;
    comments.forEach((comment, index) => {
      if (String(comment.postId) !== String(state.currentPost.id) || !comment.author || typeof comment.body !== 'string') return;
      const card = make('article', null, 'comment-card');
      const meta = make('p', null, 'comment-meta'); meta.append(make('strong', comment.author.name), make('span', `${formatDate(comment.createdAt)}${comment.updatedAt !== comment.createdAt ? ' · 수정됨' : ''}`)); card.append(meta);
      const draft = state.commentDrafts.get(comment.id);
      if (draft && draft.editing && state.user?.canWriteCommunity && comment.canEdit) {
        const form = make('form', null, 'comment-edit-form');
        const label = make('label', '댓글 수정'); label.htmlFor = `comment-edit-${index}`;
        const textarea = make('textarea'); textarea.id = label.htmlFor; textarea.value = draft.body; textarea.maxLength = 1000; textarea.required = true; textarea.rows = 4; textarea.addEventListener('input', () => { draft.body = textarea.value; });
        const feedback = make('p', null, 'form-message'); feedback.setAttribute('role', 'status'); feedback.hidden = true;
        const actions = make('div', null, 'form-bottom');
        const cancel = make('button', '취소', 'quiet-button'); cancel.type = 'button'; cancel.addEventListener('click', () => { draft.editing = false; renderComments(state.comments); });
        const submit = make('button', '댓글 저장', 'small-button'); submit.type = 'submit'; actions.append(cancel, submit); form.append(label, textarea, feedback, actions); card.append(form);
        let saving = false;
        form.addEventListener('submit', async event => {
          event.preventDefault(); if (saving) return;
          const body = textarea.value.trim(); if (!body) { feedback.textContent = '댓글 내용을 입력해 주세요.'; feedback.hidden = false; return; }
          saving = true; busy(form, true); feedback.hidden = true;
          try { await send(`/community/comments/${encodeURIComponent(comment.id)}`, 'PATCH', { body }); state.commentDrafts.delete(comment.id); await loadCurrent(); }
          catch (error) { feedback.textContent = errorText(error); feedback.hidden = false; }
          finally { saving = false; busy(form, false); }
        });
      } else {
        card.append(make('p', comment.body, 'comment-body'));
        if (state.user?.canWriteCommunity && comment.canEdit) {
          const controls = make('div', null, 'owner-actions');
          const edit = make('button', '수정', 'quiet-button'); edit.type = 'button'; edit.addEventListener('click', () => { state.commentDrafts.set(comment.id, { body: draft ? draft.body : comment.body, editing: true, original: comment.body }); renderComments(state.comments); const active = byId(`comment-edit-${index}`); if (active) active.focus(); });
          const remove = make('button', '삭제', 'quiet-button danger-button'); remove.type = 'button'; remove.addEventListener('click', () => confirmDelete('댓글을 삭제할까요?', async () => { await send(`/community/comments/${encodeURIComponent(comment.id)}`, 'DELETE'); state.commentDrafts.delete(comment.id); await loadCurrent(); }));
          controls.append(edit, remove); card.append(controls);
        }
      }
      const report = reportButton('comment', comment); if (report) card.append(report);
      list.append(card);
    });
  }
  function openEditor(post = null) {
    if (!state.user) { showAuth(); return; }
    if (!state.user.canWriteCommunity) return;
    const key = post ? `post:${post.id}` : `new:${boardId}`;
    if (state.editorKey !== key) {
      state.editorKey = key;
      state.editorOriginal = { title: post ? post.title : '', body: post ? post.body : '' };
      byId('post-title').value = state.editorOriginal.title; byId('post-body').value = state.editorOriginal.body;
    }
    byId('editor-title').textContent = post ? '글 수정' : '글쓰기'; byId('post-submit').textContent = post ? '저장' : '등록';
    byId('editor-board').textContent = `${game.name} · ${boardTitle} · ${state.user.name}`;
    message('editor-error', ''); openDialog('editor-dialog'); byId('post-title').focus();
  }
  byId('write-post').addEventListener('click', () => openEditor());
  byId('edit-post').addEventListener('click', () => { if (state.currentPost) openEditor(state.currentPost); });
  byId('editor-close').addEventListener('click', () => byId('editor-dialog').close());
  byId('editor-cancel').addEventListener('click', () => byId('editor-dialog').close());
  byId('editor-dialog').addEventListener('cancel', event => { if (state.postBusy) event.preventDefault(); });
  byId('post-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.postBusy) return;
    const title = byId('post-title').value.trim(); const body = byId('post-body').value.trim();
    if (title.length < 2 || title.length > 100 || !body || body.length > 10000) { message('editor-error', '제목은 2~100자, 내용은 1~10,000자로 입력해 주세요.'); return; }
    if (!state.user) { message('editor-error', '로그인이 필요해요. 입력한 내용은 남아 있어요.'); showAuth(); return; }
    if (!state.user.canWriteCommunity) { message('editor-error', '이 계정은 커뮤니티를 읽기만 이용할 수 있어요.'); return; }
    state.postBusy = true; busy(byId('post-form'), true); message('editor-error', '');
    try {
      const editing = state.editorKey.startsWith('post:');
      const data = editing ? await send(`/community/posts/${encodeURIComponent(state.editorKey.slice(5))}`, 'PATCH', { title, body }) : await send('/community/posts', 'POST', { game: gameId, board: boardId, title, body });
      validatePost(data.post);
      state.editorOriginal = { title, body }; byId('post-title').value = title; byId('post-body').value = body;
      byId('editor-dialog').close();
      state.commentDrafts.clear();
      if (!editing && data.reward?.pending) { showReward(`글이 등록됐어요. ${rewardText('post') || '계정 페이지에서 보상 내역을 확인해 주세요.'}`); await new Promise(resolve => setTimeout(resolve, 2000)); }
      location.href = url(boardId, data.post.id, '', 1);
    } catch (error) { message('editor-error', errorText(error)); }
    finally { state.postBusy = false; busy(byId('post-form'), false); }
  });
  function confirmDelete(title, action) {
    state.deleteAction = action; byId('confirm-title').textContent = title; message('confirm-error', ''); openDialog('confirm-dialog'); byId('confirm-cancel').focus();
  }
  byId('delete-post').addEventListener('click', () => {
    if (!state.currentPost) return;
    const id = state.currentPost.id;
    confirmDelete('이 글을 삭제할까요?', async () => { await send(`/community/posts/${encodeURIComponent(id)}`, 'DELETE'); state.editorOriginal = { title: byId('post-title').value, body: byId('post-body').value }; state.commentDrafts.clear(); byId('comment-body').value = ''; location.href = url(boardId, null, '', 1); });
  });
  byId('confirm-cancel').addEventListener('click', () => byId('confirm-dialog').close());
  byId('confirm-dialog').addEventListener('cancel', event => { if (state.confirmBusy) event.preventDefault(); });
  byId('confirm-submit').addEventListener('click', async () => {
    if (state.confirmBusy || !state.deleteAction) return;
    state.confirmBusy = true; byId('confirm-submit').disabled = true; byId('confirm-cancel').disabled = true; message('confirm-error', '');
    try { await state.deleteAction(); byId('confirm-dialog').close(); }
    catch (error) { message('confirm-error', errorText(error)); }
    finally { state.confirmBusy = false; byId('confirm-submit').disabled = false; byId('confirm-cancel').disabled = false; }
  });
  byId('comment-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.commentBusy || !state.currentPost) return;
    const body = byId('comment-body').value.trim();
    if (!body || body.length > 1000) { message('comment-error', '댓글은 1~1,000자로 입력해 주세요.'); return; }
    if (!state.user) { showAuth(); return; }
    if (!state.user.canWriteCommunity) return;
    state.commentBusy = true; busy(byId('comment-form'), true); message('comment-error', '');
    try { const data = await send(`/community/posts/${encodeURIComponent(state.currentPost.id)}/comments`, 'POST', { body }); byId('comment-body').value = ''; await loadCurrent(); if (data.reward?.pending) showReward(`댓글이 등록됐어요. ${rewardText('comment') || '계정 페이지에서 보상 내역을 확인해 주세요.'}`); }
    catch (error) { message('comment-error', errorText(error)); }
    finally { state.commentBusy = false; busy(byId('comment-form'), false); }
  });
  window.addEventListener('beforeunload', event => {
    const dirtyPost = state.editorKey && (byId('post-title').value !== state.editorOriginal.title || byId('post-body').value !== state.editorOriginal.body);
    const dirtyComment = byId('comment-body').value.trim() || [...state.commentDrafts.values()].some(item => item.body !== item.original);
    if (dirtyPost || dirtyComment) { event.preventDefault(); event.returnValue = ''; }
  });
  async function start() { await Promise.all([loadSession(), loadCurrent(), loadGuidance()]); if (state.currentPost) { byId('post-owner-actions').hidden = !(state.user?.canWriteCommunity && state.currentPost.canEdit); renderComments(state.comments); if (!document.querySelector('.post-report-button')) { const report = reportButton('post', state.currentPost); if (report) { report.classList.add('post-report-button'); byId('article-actions').append(report); } } } }
  start();
})();
