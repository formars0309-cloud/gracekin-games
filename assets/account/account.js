/* 공통 계정 UI. 인증·권한 판정과 보호자 동의 상태는 서버 응답을 따른다. */
(() => {
  'use strict';
  if (window.gracekinAccountRedirecting) return;
  const entry = window.gracekinAccountEntry || { view: 'signin', token: '', params: new URLSearchParams() };
  delete window.gracekinAccountEntry;
  const byId = id => document.getElementById(id);
  const state = { config: null, user: null, ageBand: null, view: 'signin', resetToken: entry.view === 'reset' ? entry.token : '', verifyToken: entry.view === 'verify' ? entry.token : '', guardianRequest: null, busy: false, ready: false, pendingLink: null, oauthQuery: entry.oauthQuery || '', oidc: null };
  // 소셜 공급자 표시 순서와 이름. 실제 사용 가능 여부는 서버 설정(/account/config)을 따른다.
  const PROVIDERS = [['naver', '네이버'], ['google', '구글']];
  const providerName = id => (PROVIDERS.find(([key]) => key === id) || [null, ''])[1];
  entry.token = '';
  const game = ['slimeline', 'gyeongguk'].includes(entry.params.get('game')) ? entry.params.get('game') : null;
  const boards = game === 'gyeongguk' ? ['notice', 'free', 'deck', 'strategy'] : ['notice', 'free', 'guide', 'gallery'];
  const board = boards.includes(entry.params.get('board')) ? entry.params.get('board') : 'notice';
  const communityPath = `/community/?${new URLSearchParams({ game: game || 'slimeline', board })}`;
  const studioPath = path => location.hostname === 'community.gracekingames.com' ? `https://gracekingames.com${path}` : path;
  for (const link of document.querySelectorAll('.studio-home-link')) link.href = studioPath('/');
  byId('community-link').href = communityPath;
  for (const id of ['back-link', 'guest-link']) byId(id).href = studioPath(game ? `/games/${game}/` : '/');

  const errors = {
    INVALID_EMAIL_OR_PASSWORD: '이메일과 비밀번호를 확인해 주세요.', INVALID_PASSWORD: '비밀번호를 확인해 주세요.', USER_NOT_FOUND: '이메일과 비밀번호를 확인해 주세요.',
    USER_ALREADY_EXISTS: '이미 가입된 이메일이에요. 로그인하거나 비밀번호 찾기를 이용해 주세요.', USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '이미 가입된 이메일이에요. 로그인하거나 비밀번호 찾기를 이용해 주세요.',
    INVALID_EMAIL: '이메일 주소를 확인해 주세요.', PASSWORD_TOO_SHORT: '비밀번호는 8자 이상으로 입력해 주세요.', PASSWORD_TOO_LONG: '비밀번호는 128자 이하로 입력해 주세요.',
    EMAIL_NOT_VERIFIED: '아직 이메일을 확인하지 않았어요. 받은 메일의 링크를 열고 이메일 확인 버튼을 눌러 주세요. 아래에서 인증 메일을 다시 받을 수 있어요.',
    INVALID_TOKEN: '이 링크는 사용할 수 없거나 유효기간이 지났어요. 메일을 다시 받아 주세요.', TOKEN_EXPIRED: '이 링크의 유효기간이 지났어요. 메일을 다시 받아 주세요.',
    EMAIL_NOT_CONFIGURED: '이메일 발송을 준비하고 있어요. 잠시 후 다시 확인해 주세요.', REGISTRATION_UNAVAILABLE: '새 회원가입을 준비하고 있어요. 기존 계정은 로그인할 수 있어요.',
    GUARDIAN_CONSENT_REQUIRED: '보호자 동의 확인을 먼저 완료해 주세요.', GUARDIAN_REQUEST_REQUIRED: '이 브라우저에서 보호자 동의를 먼저 신청해 주세요.',
    GUARDIAN_CONSENT_UNAVAILABLE: '보호자 동의 가입을 준비하고 있어요. 지금은 가입 없이 게임을 둘러볼 수 있어요.',
    UNAUTHORIZED: '로그인 상태가 만료되었어요. 다시 로그인해 주세요.', FORBIDDEN: '이 요청을 진행할 수 없어요. 현재 계정과 동의 상태를 확인해 주세요.'
  };
  // 소셜 로그인·게임 로그인에서 돌아온 오류 코드. {p}는 공급자 이름이다.
  const returnErrors = {
    signup_disabled: '아직 가입하지 않은 {p} 계정이에요. 회원가입에서 나이를 먼저 선택한 뒤 {p}로 가입해 주세요.',
    account_not_linked: '같은 이메일로 가입한 계정이 이미 있어요. 그 계정으로 로그인한 뒤 내 계정의 로그인 수단에서 {p}를 연결해 주세요.',
    email_not_found: '{p}에서 이메일을 받지 못했어요. 이메일 제공에 동의한 뒤 다시 시도해 주세요.',
    EMAIL_NOT_VERIFIED: '가입 확인 메일을 보냈어요. 메일의 링크로 이메일을 확인한 뒤 다시 로그인해 주세요.',
    AGE_CONFIRMATION_REQUIRED: '가입 시간이 지났거나 나이 선택을 확인하지 못했어요. 회원가입에서 나이를 다시 선택해 주세요.',
    GUARDIAN_APPROVAL_REQUIRED: '보호자 동의 상태를 확인해 주세요.',
    account_already_linked_to_different_user: '이 {p} 계정은 이미 다른 회원에게 연결되어 있어요.',
    email_does_not_match: '{p} 계정을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
    access_denied: '{p} 로그인을 취소했어요.',
    invalid_client: '게임 로그인 요청을 확인할 수 없어요. 게임으로 돌아가 다시 시도해 주세요.',
    invalid_redirect: '게임 로그인 요청을 확인할 수 없어요. 게임으로 돌아가 다시 시도해 주세요.',
    client_disabled: '지금은 이 게임의 로그인을 사용할 수 없어요.'
  };
  function returnMessage(code, provider) {
    const name = providerName(provider) || '소셜';
    const text = returnErrors[code] || (provider ? '{p} 로그인을 마치지 못했어요. 처음부터 다시 시도해 주세요.' : '로그인 요청을 마치지 못했어요. 처음부터 다시 시도해 주세요.');
    return text.split('{p}').join(name);
  }
  async function request(path, data) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('올바르지 않은 요청이에요.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(`/api${path}`, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: controller.signal });
    } catch (_) { throw new Error('연결이 끊겼거나 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.'); }
    finally { clearTimeout(timer); }
    let body;
    try { body = await response.json(); } catch (_) { throw new Error('계정 서버의 응답을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) {
      const detail = body.error || body;
      const error = new Error(response.status === 429 ? '요청이 많아요. 잠시 쉬었다 다시 시도해 주세요.' : errors[detail.code] || (/[가-힣]/.test(detail.message || '') ? detail.message : '요청을 처리하지 못했어요. 입력한 내용과 연결을 확인해 주세요.'));
      error.code = detail.code;
      throw error;
    }
    return body;
  }
  function message(id, text, focus = false) {
    const node = byId(id); node.textContent = text || ''; node.hidden = !text;
    if (text && focus) node.focus();
  }
  function clearMessages() {
    for (const node of document.querySelectorAll('.form-message')) { node.textContent = ''; node.hidden = true; }
    message('global-message', '');
  }
  function navigate(view, focus = true) {
    if (state.busy) return;
    if (view === 'signup') view = 'age';
    if (!['signin', 'age', 'signup-details', 'guardian', 'verify', 'forgot', 'reset', 'member', 'oidc-age'].includes(view)) view = 'signin';
    if (view !== 'signup-details') byId('signup-password').value = '';
    if (view !== 'signin') byId('signin-password').value = '';
    if (view !== 'reset') { byId('reset-password').value = ''; byId('reset-confirm').value = ''; state.resetToken = ''; }
    if (view !== 'verify') state.verifyToken = '';
    state.view = view;
    clearMessages();
    const panelId = view === 'signup-details' ? 'signup' : view;
    for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== `${panelId}-panel`;
    const next = new URLSearchParams({ view: view === 'age' || view === 'signup-details' ? 'signup' : view });
    if (game) next.set('game', game);
    if (game && board) next.set('board', board);
    history.replaceState(null, '', `/account/?${next}`);
    if (focus) byId(`${panelId}-title`).focus();
    if (view === 'guardian') loadGuardian();
    if (view === 'verify') {
      byId('verify-confirm').hidden = !state.verifyToken;
      byId('verify-form').hidden = !!state.verifyToken;
      byId('verify-title').textContent = state.verifyToken ? '이메일을 확인할게요' : '메일함을 확인해 주세요';
      byId('verify-description').textContent = state.verifyToken ? '아래 버튼을 누르면 이메일 확인을 마칠 수 있어요. 직접 가입을 신청한 경우에만 진행해 주세요.' : '메일의 링크를 열고 이메일 확인 버튼을 눌러 주세요. 메일이 보이지 않으면 스팸함도 확인해 주세요.';
    }
    if (view === 'reset' && !state.resetToken) {
      byId('reset-submit').disabled = true;
      message('reset-error', '비밀번호 재설정 링크가 없거나 유효기간이 지났어요. 아래에서 메일을 다시 받아 주세요.');
    }
  }
  function applyAvailability() {
    const config = state.config;
    for (const id of ['choose-adult', 'signup-submit']) byId(id).disabled = !config?.registrationAvailable;
    for (const id of ['forgot-submit', 'verify-submit', 'reset-submit']) byId(id).disabled = !config?.emailAvailable || (id === 'reset-submit' && !state.resetToken);
    byId('guardian-submit').disabled = !config?.guardianConsentAvailable;
    byId('guardian-unavailable').hidden = !!config?.guardianConsentAvailable;
    byId('guardian-content').hidden = !config?.guardianConsentAvailable;
    byId('guardian-method-description').textContent = config?.guardianConsentMethod === 'email-reply-auto'
      ? '보호자 이메일로 개인정보 처리와 어린이 가입에 관한 동의 내용을 보내 드려요. 내용을 읽고 같은 주소에서 메일의 7줄 회신 양식만 보내 주세요. 인용문·서명·첨부파일은 빼 주세요. 회신의 발신 정보와 동의 내용을 자동 확인하고, 조건이 맞으면 승인해요. 확인하기 어려운 회신은 승인하지 않고 다시 안내해요. 메일을 열거나 링크를 누르는 것만으로 동의 처리하지 않아요.'
      : '보호자 이메일로 개인정보 처리와 어린이 가입에 관한 동의 내용을 보내 드려요. 내용을 읽고 회신해 주시면 운영자가 확인해요. 메일을 열거나 링크를 누르는 것만으로 동의 처리하지 않아요.';
    renderSocial();
    if (!config) message('service-notice', '계정 서비스 상태를 확인하지 못했어요. 새 가입과 이메일 기능은 잠시 이용할 수 없지만 기존 계정으로 로그인을 시도할 수 있어요.');
    else if (!config.registrationAvailable || !config.emailAvailable) message('service-notice', '새 회원가입과 이메일 인증·비밀번호 찾기를 준비하고 있어요. 기존 계정의 로그인은 계속 이용할 수 있어요.');
    else message('service-notice', '');
  }
  function socialProviders() {
    const enabled = Array.isArray(state.config?.socialProviders) ? state.config.socialProviders : [];
    return PROVIDERS.map(([id]) => id).filter(id => enabled.includes(id));
  }
  function renderSocial() {
    const available = socialProviders();
    const signup = Boolean(state.config?.socialSignupAvailable) && available.length > 0;
    for (const [id] of PROVIDERS) {
      byId(`signin-${id}`).hidden = !available.includes(id);
      byId(`signup-${id}`).hidden = !signup || !available.includes(id);
    }
    byId('signin-social').hidden = !available.length;
    byId('signup-social').hidden = !signup || state.ageBand !== '14plus';
    byId('choose-adult-detail').textContent = signup ? `이메일 또는 ${available.map(providerName).join('·')}로 계정을 만들어요` : '이메일로 계정을 만들어요';
  }
  // 게임(OIDC) 로그인 요청은 서명된 만료 시각까지만 이어 간다.
  function activeOAuthQuery() {
    if (!state.oauthQuery) return '';
    const exp = Number(new URLSearchParams(state.oauthQuery).get('exp'));
    if (Number.isFinite(exp) && exp * 1000 - 30000 > Date.now()) return state.oauthQuery;
    state.oauthQuery = ''; state.oidc = null; renderOidc();
    message('service-notice', '게임 로그인 요청이 만료되었어요. 게임으로 돌아가 다시 로그인해 주세요.');
    return '';
  }
  function renderOidc() {
    byId('oidc-notice').hidden = !state.oauthQuery;
    byId('oidc-notice-text').textContent = state.oauthQuery && state.oidc ? `${state.oidc.clientName}에서 그레이스킨게임즈 계정 로그인을 요청했어요. 로그인을 마치면 게임으로 돌아가요.` : '';
  }
  function leaveTo(url) {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('다음 화면으로 이동하지 못했어요. 잠시 후 다시 시도해 주세요.');
    location.assign(url);
  }
  async function continueOidc() {
    const query = activeOAuthQuery();
    if (!query) return;
    message('global-message', '게임으로 돌아가고 있어요.');
    const data = await request('/auth/oauth2/continue', { postLogin: true, oauth_query: query });
    leaveTo(data.url);
  }
  // 로그인된 회원은 바로 게임으로 돌려보내고, 연령 기록이 없는 기존 회원은 먼저 나이를 고른다.
  async function prepareOidc() {
    try { state.oidc = await request('/account/oidc/context', { oauth_query: state.oauthQuery }); }
    catch (error) { state.oauthQuery = ''; state.oidc = null; renderOidc(); message('service-notice', error.message); return false; }
    renderOidc();
    if (!state.oidc.signedIn || state.oidc.loginRequired) return false;
    if (state.oidc.needsAgeConfirmation) { navigate('oidc-age', false); return true; }
    try { await continueOidc(); } catch (error) { state.oidcError = error.message; return false; }
    return true;
  }
  async function startSocial(provider, signup) {
    const body = { provider };
    if (signup) {
      const name = byId('signup-name').value.trim();
      if (state.ageBand !== '14plus') throw new Error('만 14세 이상을 선택한 뒤 간편 가입할 수 있어요.');
      if ([...name].length < 2 || [...name].length > 24) throw new Error('닉네임을 2~24자로 먼저 입력해 주세요.');
      Object.assign(body, { requestSignUp: true, ageBand: '14plus', name });
    }
    const query = activeOAuthQuery();
    if (query) body.oauth_query = query;
    const data = await request('/auth/sign-in/social', body);
    leaveTo(data.url);
  }
  function applyPendingLink() {
    if (!state.ready || state.busy || !state.pendingLink) return;
    const incoming = state.pendingLink;
    state.pendingLink = null;
    state.verifyToken = incoming.view === 'verify' ? incoming.token : '';
    state.resetToken = incoming.view === 'reset' ? incoming.token : '';
    navigate(incoming.view);
    applyAvailability();
  }
  window.addEventListener('gracekin-account-link', () => {
    const incoming = window.gracekinAccountEntry;
    delete window.gracekinAccountEntry;
    if (!incoming?.token || !['verify', 'reset'].includes(incoming.view)) return;
    // 이미 처리 중인 링크를 다시 열어도 확인 요청을 중복 예약하지 않는다.
    if ((incoming.view === 'verify' && incoming.token === state.verifyToken) || (incoming.view === 'reset' && incoming.token === state.resetToken)) return;
    state.pendingLink = { view: incoming.view, token: incoming.token };
    incoming.token = '';
    applyPendingLink();
  });
  async function withBusy(formId, errorId, action) {
    if (state.busy) return;
    const form = byId(formId);
    if (form.tagName === 'FORM' && !form.reportValidity()) return;
    state.busy = true;
    const controls = [...form.querySelectorAll('input,button')];
    controls.forEach(control => { control.disabled = true; });
    form.setAttribute('aria-busy', 'true'); message(errorId, '');
    try { await action(); }
    catch (error) { message(errorId, error.message, true); }
    finally { state.busy = false; controls.forEach(control => { control.disabled = false; }); form.setAttribute('aria-busy', 'false'); applyAvailability(); applyPendingLink(); }
  }
  let walletRequest = 0;
  function clearWallet() {
    walletRequest += 1;
    byId('grain-wallet').setAttribute('aria-busy', 'false');
    byId('grain-content').hidden = true;
    byId('grain-balance').textContent = '';
    byId('grain-entries').replaceChildren();
    byId('grain-pending').replaceChildren();
    byId('grain-pending-total').textContent = '';
    byId('grain-verify').hidden = true;
    message('grain-attendance', '');
    message('grain-eligibility', '');
    message('grain-error', '');
    message('grain-status', '');
    byId('grain-retry').hidden = true;
  }
  async function loadWallet() {
    clearWallet();
    const requestId = walletRequest;
    const userId = state.user?.id;
    if (!userId) return;
    byId('grain-wallet').setAttribute('aria-busy', 'true');
    message('grain-status', '잔액과 이용 내역을 불러오고 있어요.');
    try {
      let attendance;
      try { attendance = await request('/grain/attendance', {}); } catch (_) { /* 잔액 조회는 출석 응답 실패와 별개로 제공한다. */ }
      const data = await request('/account/grain');
      if (requestId !== walletRequest || state.user?.id !== userId) return;
      if (!Number.isSafeInteger(data.balance) || data.balance < 0 || !Array.isArray(data.entries)) throw new Error('그레인 정보를 확인하지 못했어요. 다시 불러와 주세요.');
      byId('grain-balance').textContent = new Intl.NumberFormat('ko-KR').format(data.balance);
      if (attendance?.awarded) message('grain-attendance', `오늘 출석으로 ${new Intl.NumberFormat('ko-KR').format(attendance.amount)} 그레인을 받았어요.`);
      const eligibility = { eligible: '', unverified: '이메일을 확인하면 활동 보상을 받을 수 있어요. 확인 뒤 활동부터 적용하며 확인 전 활동은 소급 지급하지 않아요.', under14: '만 14세 미만 계정은 활동·이벤트 보상 대상이 아니에요. 기존 잔액은 그대로 유지해요.', suspended: '현재 활동·이벤트 보상이 정지된 계정이에요. 자세한 내용은 문의해 주세요.' };
      message('grain-eligibility', eligibility[data.rewardEligibility] || '');
      byId('grain-verify').hidden = data.rewardEligibility !== 'unverified';
      const pending = Array.isArray(data.pending) ? data.pending : [];
      byId('grain-pending-total').textContent = new Intl.NumberFormat('ko-KR').format(data.pendingTotal || 0);
      for (const item of pending) {
        const li = document.createElement('li');
        const label = document.createElement('span'); label.textContent = item.reason || (item.targetType === 'comment' ? '댓글 작성' : '글 작성');
        const amount = document.createElement('strong'); amount.textContent = `${new Intl.NumberFormat('ko-KR').format(item.amount)} 그레인`;
        const time = document.createElement('time');
        const due = new Date(item.confirmsAt);
        if (!Number.isNaN(due.getTime())) time.dateTime = due.toISOString();
        time.textContent = Number.isNaN(due.getTime()) ? '작성 후 24시간 뒤 확정 예정' : `${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(due)} 확정 예정`;
        li.append(label, amount, time); byId('grain-pending').append(li);
      }
      byId('grain-pending-empty').hidden = pending.length !== 0;
      for (const item of data.entries) {
        const li = document.createElement('li');
        const description = document.createElement('span');
        description.textContent = item.reason;
        const amount = document.createElement('strong');
        amount.textContent = `${item.amount > 0 ? '+' : ''}${new Intl.NumberFormat('ko-KR').format(item.amount)} 그레인`;
        const time = document.createElement('time');
        time.dateTime = item.createdAt;
        time.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt));
        li.append(description, amount, time);
        byId('grain-entries').append(li);
      }
      byId('grain-empty').hidden = data.entries.length !== 0;
      byId('grain-content').hidden = false;
      message('grain-status', '');
    } catch (error) {
      if (requestId !== walletRequest || state.user?.id !== userId) return;
      message('grain-status', '');
      message('grain-error', error.message);
      byId('grain-retry').hidden = false;
    } finally {
      if (requestId === walletRequest) byId('grain-wallet').setAttribute('aria-busy', 'false');
    }
  }
  byId('grain-retry').addEventListener('click', loadWallet);
  byId('grain-verify').addEventListener('click', () => {
    if (!state.user?.email) return;
    byId('verify-email').value = state.user.email;
    navigate('verify');
    byId('verify-email').value = state.user.email;
  });
  let methodsRequest = 0;
  function clearLoginMethods() {
    methodsRequest += 1;
    byId('login-methods').hidden = true;
    byId('login-method-list').replaceChildren();
    message('login-methods-error', '');
  }
  function renderLoginMethods(data) {
    if (!Array.isArray(data?.methods) || !Array.isArray(data.available)) throw new Error('로그인 수단을 확인하지 못했어요. 새로고침해 주세요.');
    const linked = new Map(data.methods.map(item => [item.provider, item]));
    const list = byId('login-method-list');
    list.replaceChildren();
    const rows = [['email', '이메일·비밀번호'], ...PROVIDERS.filter(([id]) => data.available.includes(id) || linked.has(id))];
    for (const [id, name] of rows) {
      const item = linked.get(id);
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = name;
      const status = document.createElement('small');
      const linkedDate = item && !Number.isNaN(new Date(item.linkedAt).getTime()) ? ` · ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(item.linkedAt))}` : '';
      if (item) status.textContent = data.canUnlink ? `연결됨${linkedDate}` : `연결됨${linkedDate} · 마지막 로그인 수단이라 해제할 수 없어요`;
      else status.textContent = id === 'email' ? '연결 안 됨 · 아래 비밀번호 재설정으로 이메일 로그인을 추가할 수 있어요' : '연결 안 됨';
      li.append(title, status);
      const canLink = !item && id !== 'email' && data.available.includes(id) && state.user?.ageBand !== 'under14';
      if ((item && data.canUnlink) || canLink) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'text-button';
        button.textContent = item ? '연결 해제' : '연결하기';
        button.addEventListener('click', () => withBusy('login-methods', 'login-methods-error', async () => {
          if (!item) { const next = await request('/account/login-methods/link', { provider: id }); leaveTo(next.url); return; }
          const next = await request('/account/login-methods/unlink', { provider: id });
          renderLoginMethods(next);
          message('global-message', `${name} 로그인 연결을 해제했어요.`, true);
        }));
        li.append(button);
      }
      list.append(li);
    }
    byId('login-methods').hidden = false;
  }
  async function loadLoginMethods() {
    clearLoginMethods();
    const requestId = methodsRequest, userId = state.user?.id;
    // 소셜 공급자가 꺼져 있으면 기존 내 계정 화면을 그대로 둔다.
    if (!userId || !socialProviders().length) return;
    try {
      const data = await request('/account/login-methods');
      if (requestId !== methodsRequest || state.user?.id !== userId) return;
      renderLoginMethods(data);
    } catch (error) {
      if (requestId !== methodsRequest || state.user?.id !== userId) return;
      byId('login-methods').hidden = false;
      message('login-methods-error', error.message);
    }
  }
  function showMember() {
    byId('member-title').textContent = `${state.user.name}님, 반가워요`;
    byId('member-email').textContent = state.user.email;
    byId('member-permission').textContent = state.user.canWriteCommunity ? '커뮤니티에서 글과 댓글을 나눌 수 있어요.' : '이 계정으로는 커뮤니티의 글과 공식 안내를 읽을 수 있어요. 글·댓글 작성은 제공하지 않아요.';
    navigate('member');
    loadWallet();
    loadLoginMethods();
  }
  function showSignup(ageBand) {
    if (!state.config?.registrationAvailable || state.busy) return;
    if (ageBand === 'under14' && state.guardianRequest?.status !== 'approved') { navigate('guardian'); return; }
    state.ageBand = ageBand;
    byId('signup-step').textContent = ageBand === 'under14' ? '어린이 회원가입 · 동의 확인 완료' : '회원가입 · 2단계';
    byId('signup-description').textContent = ageBand === 'under14' ? '보호자 동의 확인을 마쳤어요. 어린이 계정 정보를 입력하고 이메일을 확인해 주세요. 커뮤니티는 읽기만 이용할 수 있어요.' : '계정을 만들고 이메일을 확인하면 로그인할 수 있어요.';
    renderSocial();
    byId('signup-email-help').textContent = ageBand === 'under14' ? '아직 가입되지 않은 보호자 이메일을 사용할 수도 있어요. 이미 다른 계정에서 쓰는 이메일로는 새 계정을 만들 수 없어요.' : '가입 확인 메일을 받을 수 있는 주소를 입력해 주세요.';
    navigate('signup-details');
  }
  const guardianMessages = {
    pending: '보호자에게 동의 내용을 이메일로 보냈어요. 보호자가 회신하면 운영자 확인 후 가입을 진행할 수 있어요. 메일을 열거나 링크를 누르는 것만으로는 동의가 완료되지 않아요.',
    approved: '보호자의 동의 확인을 마쳤어요. 이 브라우저에서 어린이 계정을 만들 수 있어요.',
    rejected: '이번 신청은 승인되지 않았어요. 자세한 안내는 보호자의 메일함을 확인해 주세요.',
    expired: '신청의 유효기간이 지났어요. 보호자 동의를 다시 신청해 주세요.',
    used: '이미 가입에 사용한 동의 신청이에요. 가입한 이메일을 확인한 뒤 로그인해 주세요.',
    withdrawn: '동의 신청이 취소되었어요. 새로 가입하려면 보호자 동의를 다시 신청해 주세요.'
  };
  function renderGuardian() {
    const info = state.guardianRequest;
    byId('guardian-form').hidden = !!info;
    byId('guardian-status').hidden = !info;
    message('guardian-review-message', '');
    if (!info) return;
    const automatic = state.config?.guardianConsentMethod === 'email-reply-auto';
    let statusMessage = guardianMessages[info.status] || '동의 상태를 확인할 수 없어요. 잠시 후 다시 확인해 주세요.';
    if (automatic && info.status === 'pending') {
      statusMessage = info.reviewStatus === 'held'
        ? '회신을 자동으로 확인하지 못해 가입 승인을 보류했어요. 아래 안내를 확인해 주세요.'
        : '보호자의 회신을 기다리고 있어요. 동의 내용을 읽고 안내 메일의 7줄 회신 양식만 같은 이메일 주소에서 보내 주세요. 인용문·서명·첨부파일은 빼 주세요. 회신을 보낸 뒤 상태를 새로고침하면 확인 결과를 볼 수 있어요.';
      if (info.reviewStatus === 'held') {
        const explanation = typeof info.reviewMessage === 'string' && info.reviewMessage.trim()
          ? info.reviewMessage.trim().slice(0, 500)
          : '보호자에게 보낸 메일에서 회신 양식을 다시 확인해 주세요. 같은 문제가 계속되면 문의하기로 알려 주세요.';
        // 서버가 제공한 안내도 HTML로 해석하지 않으며 회신 코드·원문을 화면에 표시하지 않습니다.
        message('guardian-review-message', explanation);
      }
    }
    byId('guardian-status-message').textContent = statusMessage;
    const expiry = new Date(info.expiresAt);
    const expiryText = Number.isNaN(expiry.getTime()) ? '' : ` · 유효기간 ${new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(expiry)}까지`;
    byId('guardian-request-number').textContent = info.requestNumber ? `신청 번호 ${info.requestNumber}${expiryText}` : '';
    byId('guardian-refresh').hidden = info.status !== 'pending';
    byId('guardian-continue').hidden = info.status !== 'approved';
    byId('guardian-restart').hidden = !['rejected', 'expired', 'withdrawn'].includes(info.status);
    byId('guardian-cancel').hidden = !['pending', 'approved'].includes(info.status);
  }
  async function loadGuardian() {
    if (!state.config?.guardianConsentAvailable) return;
    byId('guardian-refresh').disabled = true;
    message('guardian-status-error', '');
    try { const data = await request('/account/guardian-request'); state.guardianRequest = data.request || null; renderGuardian(); }
    catch (error) { message(state.guardianRequest ? 'guardian-status-error' : 'guardian-error', error.message, true); }
    finally { byId('guardian-refresh').disabled = false; }
  }
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => navigate(button.dataset.view));
  byId('open-signup').addEventListener('click', () => navigate('age'));
  byId('open-forgot').addEventListener('click', () => navigate('forgot'));
  byId('open-verify').addEventListener('click', () => { byId('verify-email').value = byId('signin-email').value; navigate('verify'); });
  byId('verify-another').addEventListener('click', () => { if (state.busy) return; state.verifyToken = ''; navigate('verify'); });
  byId('member-forgot').addEventListener('click', () => { byId('forgot-email').value = state.user?.email || ''; navigate('forgot'); });
  byId('choose-adult').addEventListener('click', () => showSignup('14plus'));
  for (const [id] of PROVIDERS) {
    byId(`signin-${id}`).addEventListener('click', () => withBusy('signin-panel', 'signin-error', () => startSocial(id, false)));
    byId(`signup-${id}`).addEventListener('click', () => withBusy('signup-panel', 'signup-social-error', () => startSocial(id, true)));
  }
  byId('oidc-adult').addEventListener('click', () => withBusy('oidc-age-panel', 'oidc-age-error', async () => {
    await request('/account/oidc/age', { ageBand: '14plus' });
    await continueOidc();
  }));
  byId('oidc-child').addEventListener('click', () => { byId('oidc-age-options').hidden = true; byId('oidc-child-guide').hidden = false; byId('oidc-guardian').focus(); });
  byId('oidc-guardian').addEventListener('click', () => { state.ageBand = 'under14'; navigate('guardian'); });
  byId('oidc-cancel').addEventListener('click', () => withBusy('oidc-notice', 'oidc-error', async () => {
    const query = state.oauthQuery;
    state.oauthQuery = ''; state.oidc = null; renderOidc();
    try { const data = await request('/account/oidc/cancel', { oauth_query: query }); leaveTo(data.url); }
    catch (error) { message('service-notice', `${error.message} 게임 화면으로 직접 돌아가 주세요.`); }
  }));
  byId('choose-child').addEventListener('click', () => { state.ageBand = 'under14'; navigate('guardian'); });
  byId('change-age').addEventListener('click', () => { byId('signup-form').reset(); state.ageBand = null; navigate('age'); });
  byId('signin-form').addEventListener('submit', event => {
    event.preventDefault();
    withBusy('signin-form', 'signin-error', async () => {
      const query = activeOAuthQuery();
      const result = await request('/auth/sign-in/email', { email: byId('signin-email').value.trim(), password: byId('signin-password').value, ...(query ? { oauth_query: query } : {}) });
      if (query && result && result.redirect === true) { byId('signin-password').value = ''; leaveTo(result.url); return; }
      const data = await request('/account/session');
      if (!data.user) throw new Error('로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.');
      state.user = data.user; byId('signin-password').value = '';
      state.busy = false; showMember();
    });
  });
  byId('signup-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!state.config?.registrationAvailable || !['14plus', 'under14'].includes(state.ageBand)) return;
    withBusy('signup-form', 'signup-error', async () => {
      const name = byId('signup-name').value.trim();
      if (name.length < 2 || name.length > 24) throw new Error('닉네임은 2~24자로 입력해 주세요.');
      const email = byId('signup-email').value.trim();
      let mailFailed = false;
      try { await request('/auth/sign-up/email', { name, email, password: byId('signup-password').value, ageBand: state.ageBand }); }
      catch (error) { if (error.code !== 'EMAIL_DELIVERY_FAILED') throw error; mailFailed = true; }
      byId('signup-form').reset(); state.ageBand = null; state.guardianRequest = null;
      byId('verify-email').value = email; byId('signin-email').value = email;
      state.busy = false; navigate('verify');
      if (mailFailed) message('verify-error', '계정이 만들어졌을 수 있지만 메일을 보내지 못했어요. 다시 가입하지 않고 아래에서 인증 메일을 요청해 주세요.', true);
      else message('global-message', '가입 확인 요청을 접수했어요. 메일함을 확인해 주세요. 이미 가입한 주소라면 로그인이나 비밀번호 찾기를 이용해 주세요.', true);
    });
  });
  for (const [name, endpoint, success] of [
    ['verify', '/auth/send-verification-email', '확인이 필요한 계정이라면 인증 메일을 보내 드려요. 받은 편지함과 스팸함을 확인해 주세요.'],
    ['forgot', '/auth/request-password-reset', '가입한 이메일이라면 비밀번호 재설정 메일을 보내 드려요. 받은 편지함과 스팸함을 확인해 주세요.']
  ]) byId(`${name}-form`).addEventListener('submit', event => {
    event.preventDefault(); if (!state.config?.emailAvailable) return;
    withBusy(`${name}-form`, `${name}-error`, async () => { await request(endpoint, { email: byId(`${name}-email`).value.trim() }); message('global-message', success, true); });
  });
  byId('verify-confirm-button').addEventListener('click', () => {
    if (!state.verifyToken) return;
    withBusy('verify-confirm', 'verify-confirm-error', async () => {
      await request('/account/verify-email', { token: state.verifyToken });
      state.verifyToken = ''; state.busy = false; navigate('signin');
      message('global-message', '이메일 확인을 마쳤어요. 이제 로그인할 수 있어요.', true);
    });
  });
  byId('reset-form').addEventListener('submit', event => {
    event.preventDefault(); if (!state.config?.emailAvailable || !state.resetToken) return;
    withBusy('reset-form', 'reset-error', async () => {
      if (byId('reset-password').value !== byId('reset-confirm').value) throw new Error('새 비밀번호와 확인란을 똑같이 입력해 주세요.');
      await request('/auth/reset-password', { token: state.resetToken, newPassword: byId('reset-password').value });
      state.resetToken = ''; state.user = null; clearWallet(); byId('reset-form').reset();
      state.busy = false; navigate('signin'); message('global-message', '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.', true);
    });
  });
  byId('signout-button').addEventListener('click', () => withBusy('member-panel', 'member-error', async () => {
    await request('/auth/sign-out', {}); state.user = null; clearWallet(); clearLoginMethods();
    byId('member-title').textContent = '반가워요'; byId('member-email').textContent = ''; byId('member-permission').textContent = ''; byId('signin-form').reset();
    state.busy = false; navigate('signin'); message('global-message', '로그아웃했어요.', true);
  }));
  byId('guardian-form').addEventListener('submit', event => {
    event.preventDefault(); if (!state.config?.guardianConsentAvailable) return;
    withBusy('guardian-form', 'guardian-error', async () => {
      await request('/account/guardian-requests', { guardianName: byId('guardian-name').value.trim(), guardianEmail: byId('guardian-email').value.trim() });
      byId('guardian-form').reset();
      const data = await request('/account/guardian-request'); state.guardianRequest = data.request || null;
      if (!state.guardianRequest) throw new Error('신청 상태를 확인하지 못했어요. 새로 신청하기 전에 페이지를 새로고침해 주세요.');
      renderGuardian(); byId('guardian-refresh').focus();
    });
  });
  byId('guardian-refresh').addEventListener('click', loadGuardian);
  byId('guardian-continue').addEventListener('click', () => showSignup('under14'));
  byId('guardian-restart').addEventListener('click', () => { state.guardianRequest = null; renderGuardian(); byId('guardian-name').focus(); });
  byId('guardian-cancel').addEventListener('click', () => withBusy('guardian-status', 'guardian-status-error', async () => {
    await request('/account/guardian-request/cancel', {}); state.guardianRequest = null; renderGuardian();
    message('global-message', '가입 신청을 취소했어요.', true);
  }));
  window.addEventListener('pagehide', () => {
    for (const input of document.querySelectorAll('input[type="password"]')) input.value = '';
    state.resetToken = '';
    state.verifyToken = '';
    state.pendingLink = null;
    state.user = null; clearWallet(); clearLoginMethods();
    byId('member-panel').hidden = true;
    byId('member-email').textContent = '';
    byId('member-title').textContent = '반가워요';
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { byId('loading-message').hidden = false; start(state.view); }
  });
  async function start(view = entry.view) {
    state.ready = false;
    const results = await Promise.allSettled([request('/account/config'), request('/account/session')]);
    if (results[0].status === 'fulfilled') state.config = results[0].value;
    if (results[1].status === 'fulfilled') state.user = results[1].value.user || null;
    byId('loading-message').hidden = true;
    applyAvailability();
    renderOidc();
    const oidcHandled = state.oauthQuery ? await prepareOidc() : false;
    const nextView = view === 'member' && !state.user ? 'signin' : view;
    if (oidcHandled) { /* 게임으로 돌아가거나 나이 확인 화면을 이미 열었다. */ }
    else if (state.oauthQuery && ['signin', 'signup', 'member'].includes(nextView)) navigate(nextView === 'signup' ? 'age' : 'signin', false);
    else if (state.user && ['signin', 'signup', 'member'].includes(nextView)) showMember();
    else navigate(nextView, false);
    if (entry.params.get('error') === 'INVALID_TOKEN') message('verify-error', errors.INVALID_TOKEN);
    // 소셜 로그인·연결에서 돌아온 결과는 한 번만 보여 준다.
    const returned = { provider: entry.params.get('social'), error: entry.params.get('error'), joined: entry.params.get('joined'), linked: entry.params.get('linked') };
    for (const name of ['social', 'joined', 'linked']) entry.params.delete(name);
    if (returned.error && returned.error !== 'INVALID_TOKEN') { entry.params.delete('error'); message(state.user && state.view === 'member' ? 'member-error' : 'signin-error', returnMessage(returned.error, returned.provider)); }
    if (returned.joined) message('global-message', `${providerName(returned.joined)} 계정으로 가입을 마쳤어요.`);
    if (returned.linked) message('global-message', `${providerName(returned.linked)} 로그인을 연결했어요.`);
    if (state.oidcError) { message('oidc-error', state.oidcError); state.oidcError = ''; }
    state.ready = true;
    applyPendingLink();
  }
  start();
})();
