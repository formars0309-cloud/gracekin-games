/* 공통 계정 UI. 인증·권한 판정과 보호자 동의 상태는 서버 응답을 따른다. */
(() => {
  'use strict';
  if (window.gracekinAccountRedirecting) return;
  const entry = window.gracekinAccountEntry || { view: 'signin', token: '', params: new URLSearchParams() };
  delete window.gracekinAccountEntry;
  const byId = id => document.getElementById(id);
  const state = { config: null, user: null, ageBand: null, view: 'signin', resetToken: entry.view === 'reset' ? entry.token : '', verifyToken: entry.view === 'verify' ? entry.token : '', guardianRequest: null, busy: false, ready: false, pendingLink: null };
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
    if (!['signin', 'age', 'signup-details', 'guardian', 'verify', 'forgot', 'reset', 'member'].includes(view)) view = 'signin';
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
    if (!config) message('service-notice', '계정 서비스 상태를 확인하지 못했어요. 새 가입과 이메일 기능은 잠시 이용할 수 없지만 기존 계정으로 로그인을 시도할 수 있어요.');
    else if (!config.registrationAvailable || !config.emailAvailable) message('service-notice', '새 회원가입과 이메일 인증·비밀번호 찾기를 준비하고 있어요. 기존 계정의 로그인은 계속 이용할 수 있어요.');
    else message('service-notice', '');
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
    message('grain-status', '잔액과 지급 내역을 불러오고 있어요.');
    try {
      const data = await request('/account/grain');
      if (requestId !== walletRequest || state.user?.id !== userId) return;
      if (!Number.isSafeInteger(data.balance) || data.balance < 0 || !Array.isArray(data.entries)) throw new Error('그레인 정보를 확인하지 못했어요. 다시 불러와 주세요.');
      byId('grain-balance').textContent = new Intl.NumberFormat('ko-KR').format(data.balance);
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
  function showMember() {
    byId('member-title').textContent = `${state.user.name}님, 반가워요`;
    byId('member-email').textContent = state.user.email;
    byId('member-permission').textContent = state.user.canWriteCommunity ? '커뮤니티에서 글과 댓글을 나눌 수 있어요.' : '이 계정으로는 커뮤니티의 글과 공식 안내를 읽을 수 있어요. 글·댓글 작성은 제공하지 않아요.';
    navigate('member');
    loadWallet();
  }
  function showSignup(ageBand) {
    if (!state.config?.registrationAvailable || state.busy) return;
    if (ageBand === 'under14' && state.guardianRequest?.status !== 'approved') { navigate('guardian'); return; }
    state.ageBand = ageBand;
    byId('signup-step').textContent = ageBand === 'under14' ? '어린이 회원가입 · 동의 확인 완료' : '회원가입 · 2단계';
    byId('signup-description').textContent = ageBand === 'under14' ? '보호자 동의 확인을 마쳤어요. 어린이 계정 정보를 입력하고 이메일을 확인해 주세요. 커뮤니티는 읽기만 이용할 수 있어요.' : '계정을 만들고 이메일을 확인하면 로그인할 수 있어요.';
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
  byId('choose-child').addEventListener('click', () => { state.ageBand = 'under14'; navigate('guardian'); });
  byId('change-age').addEventListener('click', () => { byId('signup-form').reset(); state.ageBand = null; navigate('age'); });
  byId('signin-form').addEventListener('submit', event => {
    event.preventDefault();
    withBusy('signin-form', 'signin-error', async () => {
      await request('/auth/sign-in/email', { email: byId('signin-email').value.trim(), password: byId('signin-password').value });
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
    await request('/auth/sign-out', {}); state.user = null; clearWallet();
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
    state.user = null; clearWallet();
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
    const nextView = view === 'member' && !state.user ? 'signin' : view;
    if (state.user && ['signin', 'signup', 'member'].includes(nextView)) showMember();
    else navigate(nextView, false);
    if (entry.params.get('error') === 'INVALID_TOKEN') message('verify-error', errors.INVALID_TOKEN);
    state.ready = true;
    applyPendingLink();
  }
  start();
})();
