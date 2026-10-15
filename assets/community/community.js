/* 게임별 공식 안내와 게시판 주소를 한곳에서 관리한다. */
(() => {
  'use strict';
  const FEEDBACK_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSezA52mxi13kKNyLORsFTjZGpxHa84rIzh7GVKfOthP6AI16w/viewform';
  const GAMES = {
    slimeline: {
      name: '슬라임 라인', english: 'SLIMELINE', home: '/games/slimeline/', privacy: 'https://slimeline.gracekingames.com/privacy.html',
      description: '작은 슬라임의 길에서 만난 이야기를 나누어요.',
      aside: '선을 그려 길을 잇는 슬라임 라인의 소식과 이용 안내예요.',
      boards: { free: ['자유게시판', '슬라임과 함께한 순간, 자유롭게 나눌 이야기를 위한 자리예요.'], guide: ['공략·팁', '길을 잇는 작은 발견과 나만의 풀이를 위한 자리예요.'], gallery: ['갤러리', '모험 속에서 만난 풍경과 기억을 위한 자리예요.'], notice: ['공지사항', '슬라임 라인의 공식 소식과 게임 이용 안내를 확인하세요.'] },
      posts: [
        { id: 'welcome', title: '슬라임 라인에 오신 것을 환영해요', excerpt: '선을 그려, 작은 슬라임의 다음 걸음을 이어 주세요.', sections: [
          ['작은 선에서 시작되는 모험', '슬라임 라인은 선을 그려 슬라임의 길을 만드는 퍼즐 게임이에요. 사계절 모험, 우리 마을과 봄 산책 섬을 만나 보세요.'],
          ['모험을 시작하려면', '슬라임 라인 홈페이지의 START를 누르면 게임으로 이동해요. 게임을 시작하기 전에 홈페이지에서 소개와 이용 안내를 살펴볼 수 있어요.'],
          ['이곳에서 만나요', '커뮤니티에서는 공식 소식과 이용 안내를 읽을 수 있어요. 로그인하면 자유게시판과 공략·팁, 갤러리에서 글과 댓글을 남길 수 있어요. 버그 제보와 문의는 제보·의견 보내기를 이용해 주세요.']
        ] },
        { id: 'play-guide', title: '슬라임 라인, 처음 시작하는 분께', excerpt: '게임을 여는 방법과 문제가 생겼을 때 확인할 곳을 모았어요.', sections: [
          ['게임 홈페이지에서 START', '게임 홈페이지의 START를 누르면 슬라임 라인이 열려요. 설치 없이 브라우저에서 즐기는 게임이며, 현재 테스트 중이에요.'],
          ['선을 그려 길을 이어요', '슬라임이 지나갈 길을 선으로 만들어 주세요. 게임 화면에 나오는 안내를 보며 한 걸음씩 시작하면 돼요.'],
          ['막히거나 오류를 만났다면', '화면이 멈추거나 예상과 다르게 움직인다면 제보·의견 보내기로 알려 주세요. 이용한 기기와 브라우저, 문제가 생긴 화면과 상황을 함께 적어 주시면 확인에 도움이 돼요.']
        ] },
        { id: 'feedback', title: '버그 제보와 의견은 여기로 보내 주세요', excerpt: '플레이하다 만난 문제나 떠오른 생각을 편지로 받습니다.', sections: [
          ['로그인 없이 편지를 보낼 수 있어요', '제보·의견 보내기를 누르면 그레이스킨 게임즈의 구글 설문지가 열려요. 이메일을 수집하지 않으며, 로그인 없이 보낼 수 있어요.'],
          ['어떤 상황이었는지 알려 주세요', '게임 이름을 슬라임 라인으로 적고, 어떤 화면에서 무슨 일이 있었는지 알려 주세요. 기기와 브라우저, 오류가 반복되는 순서가 있으면 함께 적어 주세요. 비밀번호나 인증 코드 등 민감한 정보는 적지 마세요.'],
          ['다른 문의가 있다면', '이메일 문의는 support@gracekingames.com으로 보내 주세요.']
        ] }
      ]
    },
    gyeongguk: {
      name: '경국지계', english: 'GYEONGGUK', home: '/games/gyeongguk/', privacy: 'https://gyeongguk.gracekingames.com/privacy',
      description: '한 장의 계략, 한 판의 이야기가 모이는 곳.',
      aside: '미인과 계략의 삼국 카드 대전, 경국지계의 공식 소식과 이용 안내입니다.',
      boards: { free: ['자유게시판', '한 판을 마친 소감과 자유로운 이야기를 위한 자리입니다.'], deck: ['덱 연구', '카드의 조합과 덱에 대한 생각을 위한 자리입니다.'], strategy: ['전략·공략', '대전에서 발견한 수와 계략을 위한 자리입니다.'], notice: ['공지사항', '경국지계의 공식 소식과 게임 이용 안내를 확인하세요.'] },
      posts: [
        { id: 'welcome', title: '경국지계에 오신 것을 환영합니다', excerpt: '덮어 둔 카드 한 장이 판을 뒤집는 삼국 카드 대전.', sections: [
          ['미인과 계략의 삼국 카드 대전', '경국지계는 실시간 카드 대전 게임입니다. 게임 홈페이지에서 소개를 살펴보고 START를 눌러 대전에 들어가세요.'],
          ['현재는 테스트 기간입니다', '테스트 기간에는 전설을 포함한 모든 카드를 사용할 수 있습니다. 플레이 기록은 정식 시즌 전에 초기화될 수 있습니다.'],
          ['공식 소식과 이용 안내', '이곳에서는 공식 소식과 이용 안내를 읽을 수 있습니다. 로그인하면 자유게시판, 덱 연구, 전략·공략에서 글과 댓글을 남길 수 있습니다. 버그 제보와 문의는 제보·의견 보내기를 이용해 주세요.']
        ] },
        { id: 'play-guide', title: '경국지계, 대전에 들어가기 전에', excerpt: '게임 시작 방법과 테스트 기간의 이용 안내입니다.', sections: [
          ['게임 홈페이지에서 START', '경국지계 홈페이지의 START를 누르면 게임으로 이동합니다. 브라우저에서 설치 없이 시작할 수 있습니다.'],
          ['게임 안의 안내를 확인하세요', '게임에 들어가면 화면에 표시된 안내를 따라 진행하세요. 테스트 기간에는 전설을 포함한 모든 카드를 사용할 수 있으며, 기록은 정식 시즌 전에 초기화될 수 있습니다.'],
          ['플레이 중 도움이 필요하다면', '게임 안의 문제 신고와 소감 남기기로 의견을 보낼 수 있습니다. 홈페이지의 제보·의견 보내기도 이용할 수 있습니다.']
        ] },
        { id: 'feedback', title: '문제 신고와 소감을 보내는 방법', excerpt: '대전 중 만난 문제와 카드에 대한 생각을 들려주세요.', sections: [
          ['게임 안에서 바로 보내기', '경국지계 안의 문제 신고와 소감 남기기를 이용할 수 있습니다. 문제가 생긴 상황과 화면을 함께 알려 주시면 확인에 도움이 됩니다.'],
          ['홈페이지에서 보내기', '제보·의견 보내기를 누르면 그레이스킨 게임즈의 구글 설문지가 열립니다. 로그인 없이 이용할 수 있고 이메일을 수집하지 않습니다. 게임 이름을 경국지계로 적어 주세요. 비밀번호나 인증 코드는 보내지 마세요.'],
          ['이메일로 문의하기', '다른 문의는 support@gracekingames.com으로 보내 주세요.']
        ] }
      ]
    }
  };
  const params = new URLSearchParams(location.search);
  const gameId = params.get('game');
  const game = Object.prototype.hasOwnProperty.call(GAMES, gameId) ? GAMES[gameId] : null;
  const byId = id => document.getElementById(id);
  const make = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined && text !== null) element.textContent = text; if (className) element.className = className; return element; };
  if (!game) {
    byId('game-picker').hidden = false;
    byId('community-content').hidden = true;
    byId('privacy-link').hidden = true;
    return;
  }
  const boardId = Object.prototype.hasOwnProperty.call(game.boards, params.get('board')) ? params.get('board') : 'notice';
  const query = (params.get('q') || '').slice(0, 80).trim();
  const pageNumber = Math.min(10000, Math.max(1, Number.parseInt(params.get('page'), 10) || 1));
  const requestedPost = params.get('post');
  const state = { user: null, draftOwnerId: null, authMode: 'signin', authBusy: false, postBusy: false, commentBusy: false, confirmBusy: false, currentPost: null, editorKey: null, editorOriginal: { title: '', body: '' }, deleteAction: null, loadVersion: 0, commentDrafts: new Map() };
  const url = (board, post, search = query, page = 1) => { const next = new URLSearchParams({ game: gameId, board }); if (post) next.set('post', post); if (search) next.set('q', search); if (page > 1) next.set('page', page); return `/community/?${next}`; };
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
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('올바르지 않은 요청이에요.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(`/api${path}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: controller.signal });
    } catch (_) {
      showConnection();
      throw new Error('연결이 끊겼거나 응답이 늦어지고 있어요. 입력한 내용은 남아 있어요. 다시 등록하기 전에 목록을 확인해 주세요.');
    } finally { clearTimeout(timer); }
    let data;
    try { data = await response.json(); } catch (_) { showConnection(); throw new Error('커뮤니티 연결을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) {
      const detail = data.error || data;
      const error = new Error(response.status === 429 ? '요청이 많아요. 잠시 쉬었다 다시 시도해 주세요.' : authMessages[detail.code] || (/[가-힣]/.test(detail.message || '') ? detail.message : '요청을 처리하지 못했어요. 입력한 내용을 확인해 주세요.'));
      error.status = response.status;
      if (response.status === 401) { state.user = null; renderSession(); }
      if (response.status >= 500) showConnection();
      throw error;
    }
    connectionRestored();
    return data;
  }
  const send = (path, method, data) => request(path, { method, body: JSON.stringify(data || {}) });
  const formatDate = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date); };
  function busy(form, value) { for (const control of form.querySelectorAll('button,input,textarea')) control.disabled = value; form.setAttribute('aria-busy', String(value)); }
  function openDialog(id) { const dialog = byId(id); if (!dialog.open) dialog.showModal(); }
  function renderSession() {
    byId('session-label').textContent = state.user ? `${state.user.name}님, 반가워요.` : '누구나 읽고, 로그인하면 함께 쓸 수 있어요.';
    byId('open-signin').hidden = !!state.user;
    byId('open-signup').hidden = !!state.user;
    byId('signout-button').hidden = !state.user;
    byId('comment-form').hidden = !state.user;
    byId('comment-login').hidden = !!state.user;
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
    try {
      const data = await request('/community/session');
      const nextUser = data.user || null;
      const changedOwner = nextUser && state.draftOwnerId && String(nextUser.id) !== String(state.draftOwnerId);
      state.user = nextUser;
      if (changedOwner) clearDrafts();
      if (nextUser) state.draftOwnerId = nextUser.id;
      renderSession();
    }
    catch (_) { state.user = null; renderSession(); byId('session-label').textContent = '로그인 상태를 확인할 수 없어요.'; }
  }
  function showAuth(mode = 'signin') {
    state.authMode = mode;
    const signup = mode === 'signup';
    byId('name-field').hidden = !signup;
    byId('auth-name').required = signup;
    byId('signup-note').hidden = !signup;
    byId('auth-title').textContent = signup ? '커뮤니티 회원가입' : '커뮤니티 로그인';
    byId('auth-submit').textContent = signup ? '회원가입' : '로그인';
    byId('auth-switch').textContent = signup ? '이미 계정이 있나요? 로그인' : '처음 오셨나요? 회원가입';
    byId('auth-password').autocomplete = signup ? 'new-password' : 'current-password';
    byId('auth-close').setAttribute('aria-label', signup ? '회원가입 창 닫기' : '로그인 창 닫기');
    message('auth-error', '');
    openDialog('auth-dialog');
    (signup ? byId('auth-name') : byId('auth-email')).focus();
  }
  byId('open-signin').addEventListener('click', () => showAuth());
  byId('open-signup').addEventListener('click', () => showAuth('signup'));
  byId('comment-open-signin').addEventListener('click', () => showAuth());
  byId('auth-switch').addEventListener('click', () => showAuth(state.authMode === 'signin' ? 'signup' : 'signin'));
  byId('auth-close').addEventListener('click', () => byId('auth-dialog').close());
  byId('auth-dialog').addEventListener('close', () => { byId('auth-password').value = ''; });
  byId('auth-dialog').addEventListener('cancel', event => { if (state.authBusy) event.preventDefault(); });
  byId('auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.authBusy) return;
    const signup = state.authMode === 'signup';
    const name = byId('auth-name').value.trim();
    if (signup && (name.length < 2 || name.length > 24)) { message('auth-error', '닉네임은 2~24자로 입력해 주세요.'); return; }
    if (!byId('auth-form').reportValidity()) return;
    state.authBusy = true; busy(byId('auth-form'), true); message('auth-error', '');
    try {
      const data = { email: byId('auth-email').value.trim(), password: byId('auth-password').value };
      if (signup) data.name = name;
      await send(signup ? '/auth/sign-up/email' : '/auth/sign-in/email', 'POST', data);
      await loadSession();
      if (!state.user) throw new Error('로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.');
      byId('auth-dialog').close();
      await loadCurrent();
    } catch (error) { message('auth-error', errorText(error)); }
    finally { state.authBusy = false; busy(byId('auth-form'), false); }
  });
  byId('signout-button').addEventListener('click', async () => {
    const button = byId('signout-button'); if (button.disabled) return; button.disabled = true;
    try { await send('/auth/sign-out', 'POST'); state.user = null; state.draftOwnerId = null; clearDrafts(); byId('auth-email').value = ''; byId('auth-name').value = ''; byId('auth-password').value = ''; renderSession(); await loadCurrent(); }
    catch (error) { showConnection(); byId('connection-message').textContent = errorText(error); }
    finally { button.disabled = false; }
  });
  document.body.dataset.game = gameId;
  document.querySelector('meta[name="theme-color"]').content = gameId === 'slimeline' ? '#21172e' : '#f3efe6';
  byId('game-eyebrow').textContent = game.english;
  byId('hero-description').textContent = game.description;
  byId('aside-description').textContent = game.aside;
  byId('home-link').href = game.home;
  byId('privacy-link').href = game.privacy;
  byId('article-home').href = game.home;
  byId('article-feedback').href = FEEDBACK_URL;
  byId('connection-notice').href = url('notice', null, '');
  for (const [id, [label]] of Object.entries(game.boards)) {
    const tab = make('a', label); tab.href = url(id, null, ''); if (id === boardId) tab.setAttribute('aria-current', 'page'); byId('board-tabs').append(tab);
  }
  const [boardTitle, boardDescription] = game.boards[boardId];
  byId('board-title').textContent = boardTitle;
  byId('board-description').textContent = boardDescription;
  byId('search-input').value = query;
  byId('write-post').hidden = boardId === 'notice';
  byId('board-help').textContent = boardId === 'gallery' ? '지금은 글로 추억을 나눌 수 있어요. 사진 첨부는 지원하지 않아요.' : '';
  byId('search-form').addEventListener('submit', event => { event.preventDefault(); location.href = url(boardId, null, byId('search-input').value.trim()); });
  byId('back-to-board').href = url(boardId, null, query, pageNumber);
  byId('retry-connection').addEventListener('click', async () => { byId('retry-connection').disabled = true; try { await loadSession(); await loadCurrent(); } finally { byId('retry-connection').disabled = false; } });
  function empty(title, description, href = url('notice', null, ''), label = '공식 안내 보기 →') {
    byId('empty-state').hidden = false; byId('empty-title').textContent = title; byId('empty-description').textContent = description; byId('empty-link').href = href; byId('empty-link').textContent = label;
  }
  function row(item, official = false) {
    const link = make('a', null, 'post-row'); link.href = url(boardId, item.id, query, pageNumber);
    const meta = make('div', null, 'post-meta'); meta.append(make('span', official ? '공식 안내' : boardTitle, 'post-badge'), make('span', official ? '그레이스킨 게임즈' : item.author.name));
    if (!official) meta.append(make('span', formatDate(item.createdAt)));
    link.append(make('span', '↗', 'post-arrow'), meta, make('h3', item.title), make('p', official ? item.excerpt : item.body.replace(/\s+/g, ' ').slice(0, 160)));
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
    byId('article-title').textContent = post.title; byId('article-badge').textContent = '공식 안내'; byId('article-author').textContent = '그레이스킨 게임즈';
    for (const [heading, body] of post.sections) byId('article-body').append(make('h3', heading), make('p', body));
  }
  async function loadCurrent() {
    const version = ++state.loadVersion;
    byId('post-list').replaceChildren(); byId('pagination').hidden = true; byId('empty-state').hidden = true;
    byId('article-body').replaceChildren(); byId('post-owner-actions').hidden = true; byId('comments-section').hidden = true; byId('article-actions').hidden = false;
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
      for (const item of posts) byId('post-list').append(row(item, true));
      if (!posts.length) empty('검색 결과가 없어요', '다른 검색어를 입력하거나 공식 안내를 살펴보세요.');
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
        if (!data.posts.length) empty(query ? '검색 결과가 없어요' : '아직 올라온 이야기가 없어요', query ? '다른 검색어를 입력하거나 게시판 목록을 확인해 보세요.' : '이 게임의 첫 이야기를 남겨 보세요. 로그인하면 글과 댓글을 쓸 수 있어요.', url(boardId, null, ''), '게시판 새로 보기 →');
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
    byId('post-owner-actions').hidden = !(state.user && post.canEdit);
    byId('comments-section').hidden = false;
    byId('comments-title').textContent = `댓글 ${comments.length}`;
    renderComments(comments); renderSession();
  }
  function renderComments(comments) {
    const list = byId('comment-list'); list.replaceChildren(); byId('comment-empty').hidden = comments.length > 0;
    comments.forEach((comment, index) => {
      if (String(comment.postId) !== String(state.currentPost.id) || !comment.author || typeof comment.body !== 'string') return;
      const card = make('article', null, 'comment-card');
      const meta = make('p', null, 'comment-meta'); meta.append(make('strong', comment.author.name), make('span', `${formatDate(comment.createdAt)}${comment.updatedAt !== comment.createdAt ? ' · 수정됨' : ''}`)); card.append(meta);
      const draft = state.commentDrafts.get(comment.id);
      if (draft && draft.editing && state.user && comment.canEdit) {
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
        if (state.user && comment.canEdit) {
          const controls = make('div', null, 'owner-actions');
          const edit = make('button', '수정', 'quiet-button'); edit.type = 'button'; edit.addEventListener('click', () => { state.commentDrafts.set(comment.id, { body: draft ? draft.body : comment.body, editing: true, original: comment.body }); renderComments(state.comments); const active = byId(`comment-edit-${index}`); if (active) active.focus(); });
          const remove = make('button', '삭제', 'quiet-button danger-button'); remove.type = 'button'; remove.addEventListener('click', () => confirmDelete('댓글을 삭제할까요?', async () => { await send(`/community/comments/${encodeURIComponent(comment.id)}`, 'DELETE'); state.commentDrafts.delete(comment.id); await loadCurrent(); }));
          controls.append(edit, remove); card.append(controls);
        }
      }
      list.append(card);
    });
  }
  function openEditor(post = null) {
    if (!state.user) { showAuth(); return; }
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
    state.postBusy = true; busy(byId('post-form'), true); message('editor-error', '');
    try {
      const editing = state.editorKey.startsWith('post:');
      const data = editing ? await send(`/community/posts/${encodeURIComponent(state.editorKey.slice(5))}`, 'PATCH', { title, body }) : await send('/community/posts', 'POST', { game: gameId, board: boardId, title, body });
      validatePost(data.post);
      state.editorOriginal = { title, body }; byId('post-title').value = title; byId('post-body').value = body;
      byId('editor-dialog').close();
      state.commentDrafts.clear();
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
    state.commentBusy = true; busy(byId('comment-form'), true); message('comment-error', '');
    try { await send(`/community/posts/${encodeURIComponent(state.currentPost.id)}/comments`, 'POST', { body }); byId('comment-body').value = ''; await loadCurrent(); }
    catch (error) { message('comment-error', errorText(error)); }
    finally { state.commentBusy = false; busy(byId('comment-form'), false); }
  });
  window.addEventListener('beforeunload', event => {
    const dirtyPost = state.editorKey && (byId('post-title').value !== state.editorOriginal.title || byId('post-body').value !== state.editorOriginal.body);
    const dirtyComment = byId('comment-body').value.trim() || [...state.commentDrafts.values()].some(item => item.body !== item.original);
    if (dirtyPost || dirtyComment) { event.preventDefault(); event.returnValue = ''; }
  });
  async function start() { await Promise.all([loadSession(), loadCurrent()]); if (state.currentPost) { byId('post-owner-actions').hidden = !(state.user && state.currentPost.canEdit); renderComments(state.comments); } }
  start();
})();
