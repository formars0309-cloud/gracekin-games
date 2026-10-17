/* 본인 제보는 서버 세션으로만 조회하며 다른 회원을 지정하는 경로를 만들지 않는다. */
(() => {
  'use strict';
  if (window.gracekinCommunityRedirecting) return;
  const { byId, make, request, message, busy, formatDate, detail } = window.grainTools;
  let signedIn = false, sending = false, version = 0, activeUserId = null;
  const statuses = new Set(['접수', '확인 중', '중복', '재현 불가', '채택', '수정 완료']);
  async function issues() {
    byId('issues-refresh').disabled = true; message(byId('issues-status'), '문제를 확인하고 있어요.');
    try {
      const data = await request('/community/known-issues');
      if (!Array.isArray(data.issues)) throw new Error('알려진 문제를 확인하지 못했어요.');
      byId('known-issues').replaceChildren();
      for (const item of data.issues) { const card = make('article', null, 'tool-record'); card.append(make('h3', item.title)); detail(card, '상태', item.status); detail(card, '안내', item.summary); byId('known-issues').append(card); }
      message(byId('issues-status'), data.issues.length ? '' : '현재 안내 중인 문제가 없어요.');
    } catch (error) { message(byId('issues-status'), error.message, true); }
    finally { byId('issues-refresh').disabled = false; }
  }
  function clearPrivate() { version++; signedIn = false; activeUserId = null; message(byId('bug-session'), '로그인 상태를 다시 확인해 주세요.'); byId('bug-private').hidden = true; byId('my-reports').replaceChildren(); byId('bug-form').reset(); message(byId('bug-result'), ''); }
  async function mine() {
    if (!signedIn) return; const current = version;
    byId('mine-refresh').disabled = true; message(byId('mine-status'), '내 제보를 확인하고 있어요.');
    try {
      const data = await request('/community/bug-reports'); if (!signedIn || current !== version) return;
      if (!Array.isArray(data.reports)) throw new Error('제보 목록을 확인하지 못했어요.');
      byId('my-reports').replaceChildren();
      for (const item of data.reports) { const card = make('article', null, 'tool-record'); card.append(make('h3', '비공개 제보')); detail(card, '접수번호', item.id); detail(card, '상태', statuses.has(item.status) ? item.status : '상태 확인 필요'); detail(card, '채택 등급', ({ simple: '단순', normal: '일반', critical: '중대' })[item.grade]); detail(card, '접수', formatDate(item.createdAt)); detail(card, '최근 변경', formatDate(item.updatedAt)); byId('my-reports').append(card); }
      message(byId('mine-status'), data.reports.length ? '' : '아직 접수한 제보가 없어요.');
    } catch (error) { if (error.status === 401 || error.status === 403) { clearPrivate(); byId('bug-login').hidden = false; } message(byId('mine-status'), error.message, true); }
    finally { byId('mine-refresh').disabled = false; }
  }
  async function session() {
    byId('session-refresh').disabled = true;
    try { const data = await request('/account/session'); if (!data.user) { clearPrivate(); message(byId('bug-session'), '로그인한 회원만 비공개 제보를 접수할 수 있어요.'); byId('bug-login').hidden = false; return; } if (activeUserId && activeUserId !== data.user.id) clearPrivate(); activeUserId = data.user.id; signedIn = true; byId('bug-private').hidden = false; byId('bug-login').hidden = true; message(byId('bug-session'), `${data.user.name}님의 비공개 제보예요.`); await mine(); }
    catch (error) { clearPrivate(); message(byId('bug-session'), error.message, true); byId('bug-login').hidden = false; }
    finally { byId('session-refresh').disabled = false; }
  }
  byId('bug-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; if (sending || !signedIn || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form)); for (const key of Object.keys(data)) data[key] = data[key].trim();
    if ([...data.title].length < 2 || [...data.body].length < 10) { message(byId('bug-result'), '제목은 2자 이상, 문제 설명은 10자 이상 입력해 주세요.', true); return; }
    sending = true; const current = version; busy(form, true); message(byId('bug-result'), '');
    try { await request('/community/bug-reports', data); if (current !== version) return; form.reset(); message(byId('bug-result'), '비공개로 접수했어요. 아래 내 제보에서 처리 상태를 확인할 수 있어요.'); await mine(); }
    catch (error) { if (error.status === 401 || error.status === 403) { clearPrivate(); byId('bug-login').hidden = false; message(byId('bug-session'), '로그인 상태를 다시 확인해 주세요.'); } else message(byId('bug-result'), error.message, true); }
    finally { sending = false; busy(form, false); }
  });
  byId('issues-refresh').addEventListener('click', issues); byId('mine-refresh').addEventListener('click', mine); byId('session-refresh').addEventListener('click', session);
  window.addEventListener('pagehide', clearPrivate); window.addEventListener('pageshow', event => { if (event.persisted) { session(); issues(); } });
  issues(); session();
})();
