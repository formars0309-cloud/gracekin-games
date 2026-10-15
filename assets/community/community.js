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
          ['이곳에서 만나요', '커뮤니티에서는 공식 소식과 이용 안내를 읽을 수 있어요. 지금은 직접 글이나 댓글을 남기는 기능을 제공하지 않아요. 전하고 싶은 이야기는 제보·의견 보내기로 들려주세요.']
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
          ['공식 소식과 이용 안내', '이곳에서는 공식 소식과 이용 안내를 읽을 수 있습니다. 현재 직접 글이나 댓글을 작성하는 기능은 제공하지 않습니다. 제안이나 소감은 제보·의견 보내기로 전해 주세요.']
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
  const make = (tag, text, className) => { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; };
  if (!game) {
    byId('game-picker').hidden = false;
    byId('community-content').hidden = true;
    byId('privacy-link').hidden = true;
    return;
  }
  document.body.dataset.game = gameId;
  document.querySelector('meta[name="theme-color"]').content = gameId === 'slimeline' ? '#21172e' : '#f3efe6';
  byId('game-eyebrow').textContent = game.english;
  byId('hero-description').textContent = game.description;
  byId('aside-description').textContent = game.aside;
  byId('home-link').href = game.home;
  byId('privacy-link').href = game.privacy;
  byId('article-home').href = game.home;
  byId('article-feedback').href = FEEDBACK_URL;
  const boardId = Object.prototype.hasOwnProperty.call(game.boards, params.get('board')) ? params.get('board') : 'notice';
  const query = (params.get('q') || '').slice(0, 80).trim();
  const url = (board, post, search) => { const next = new URLSearchParams({ game: gameId, board }); if (post) next.set('post', post); if (search) next.set('q', search); return `/community/?${next}`; };
  for (const [id, [label]] of Object.entries(game.boards)) {
    const tab = make('a', label); tab.href = url(id); if (id === boardId) tab.setAttribute('aria-current', 'page'); byId('board-tabs').append(tab);
  }
  const [boardTitle, boardDescription] = game.boards[boardId];
  byId('board-title').textContent = boardTitle;
  byId('board-description').textContent = boardDescription;
  byId('search-input').value = query;
  byId('search-form').addEventListener('submit', event => { event.preventDefault(); location.href = url(boardId, null, byId('search-input').value.trim()); });
  const requestedPost = params.get('post');
  const post = boardId === 'notice' ? game.posts.find(item => item.id === requestedPost) : null;
  if (post) {
    document.title = `${post.title} · ${game.name} 커뮤니티`;
    byId('board-view').hidden = true;
    byId('article-view').hidden = false;
    byId('article-title').textContent = post.title;
    byId('back-to-board').href = url(boardId, null, query);
    for (const [heading, body] of post.sections) byId('article-body').append(make('h3', heading), make('p', body));
  } else {
    document.title = `${boardTitle} · ${game.name} 커뮤니티`;
    const needle = query.toLocaleLowerCase('ko');
    const posts = boardId === 'notice' ? game.posts.filter(item => [item.title, item.excerpt, ...item.sections.flat()].join(' ').toLocaleLowerCase('ko').includes(needle)) : [];
    byId('result-count').textContent = query ? `검색 결과 ${posts.length}개` : boardId === 'notice' ? `공식 안내 ${posts.length}개` : '';
    for (const item of posts) {
      const row = make('a', null, 'post-row'); row.href = url('notice', item.id, query);
      const meta = make('div', null, 'post-meta'); meta.append(make('span', '공식 안내', 'post-badge'), make('span', '그레이스킨 게임즈'));
      row.append(make('span', '↗', 'post-arrow'), meta, make('h3', item.title), make('p', item.excerpt)); byId('post-list').append(row);
    }
    if (!posts.length) {
      byId('empty-state').hidden = false;
      const missingPost = requestedPost && !post;
      byId('empty-title').textContent = missingPost ? '이 안내를 찾을 수 없어요' : query ? '검색 결과가 없어요' : '아직 공개된 글이 없어요';
      byId('empty-description').textContent = missingPost ? '공식 안내 목록에서 찾으시는 내용을 확인해 주세요.' : query ? '다른 검색어를 입력하거나 공식 안내를 살펴보세요.' : '지금은 공식 안내를 읽을 수 있어요. 게임에 관한 제안과 소감은 의견 보내기로 전해 주세요.';
      byId('empty-link').href = url('notice');
    }
  }
})();
