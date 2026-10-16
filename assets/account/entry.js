/* 인증 링크의 비밀값을 주소에서 즉시 지우고, 고정된 계정 서버에서만 처리한다. */
(() => {
  'use strict';
  const ACCOUNT_ORIGIN = 'https://community.gracekingames.com';
  const allowedViews = new Set(['signin', 'signup', 'forgot', 'reset', 'verify', 'guardian']);
  const isPages = location.hostname === 'gracekingames.com' || location.hostname === 'www.gracekingames.com';
  const providers = ['naver', 'google'];
  // 소셜 로그인·게임 로그인에서 돌아온 오류는 알려진 코드만 화면에 넘긴다.
  const knownErrors = new Set(['INVALID_TOKEN', 'signup_disabled', 'account_not_linked', 'email_not_found', 'EMAIL_NOT_VERIFIED', 'AGE_CONFIRMATION_REQUIRED', 'GUARDIAN_APPROVAL_REQUIRED', 'account_already_linked_to_different_user', 'unable_to_link_account', 'email_does_not_match', 'access_denied', 'state_mismatch', 'state_not_found', 'please_restart_the_process', 'invalid_code', 'unable_to_get_user_info', 'unable_to_create_user', 'invalid_client', 'invalid_redirect', 'client_disabled']);
  // 공통 계정이 서명한 게임 로그인 요청(OIDC) 값만 골라 화면에 넘긴다. 서명은 서버가 다시 검사한다.
  function signedOAuthQuery(params) {
    if (!params.has('sig') || !params.has('client_id')) return '';
    const names = new Set(params.getAll('ba_param'));
    if (!names.size) return '';
    const signed = new URLSearchParams();
    for (const [key, value] of params) if (key === 'sig' || key === 'ba_param' || names.has(key)) signed.append(key, value);
    return signed.toString().length <= 8192 ? signed.toString() : '';
  }
  window.gracekinAccountRedirecting = isPages;
  function receiveLink() {
    const params = new URLSearchParams(location.search);
    const fragment = new URLSearchParams(location.hash.slice(1));
    const supplied = fragment.get('token') || params.get('token') || '';
    const view = allowedViews.has(params.get('view')) ? params.get('view') : 'signin';
    const token = ['reset', 'verify'].includes(view) ? supplied : '';
    const clean = new URLSearchParams({ view });
    if (['slimeline', 'gyeongguk'].includes(params.get('game'))) clean.set('game', params.get('game'));
    if (['notice', 'free', 'guide', 'gallery', 'deck', 'strategy'].includes(params.get('board'))) clean.set('board', params.get('board'));
    if (params.get('error') === 'INVALID_TOKEN') clean.set('error', 'INVALID_TOKEN');
    else if (params.has('error') && !isPages) clean.set('error', knownErrors.has(params.get('error')) ? params.get('error') : 'unknown_error');
    for (const name of ['social', 'joined', 'linked']) if (!isPages && providers.includes(params.get(name))) clean.set(name, params.get(name));
    const oauthQuery = isPages ? '' : signedOAuthQuery(params);
    history.replaceState(null, '', `/account/?${clean}`);
    if (isPages) {
      const destination = new URL('/account/', ACCOUNT_ORIGIN);
      destination.search = clean.toString();
      if (token) destination.hash = new URLSearchParams({ token }).toString();
      location.replace(destination.href);
      return;
    }
    window.gracekinAccountEntry = { view, token, params: clean, oauthQuery };
    window.dispatchEvent(new Event('gracekin-account-link'));
  }
  // 같은 탭에서 인증 메일을 열어 해시만 바뀌어도 URL에 비밀값을 남기지 않는다.
  window.addEventListener('hashchange', receiveLink);
  receiveLink();
})();
