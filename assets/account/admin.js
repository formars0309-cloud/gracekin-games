/* 운영 권한·입력·중복 지급 검증은 서버에 맡기고 화면에는 최소 정보만 표시한다. */
(() => {
  'use strict';
  if (window.gracekinCommunityRedirecting) return;
  const { byId, make, request, message, busy, field, formatDate, detail } = window.grainTools;
  let authorized = false, generation = 0;
  const eligibility = { eligible: '보상 가능', unverified: '이메일 미확인', under14: '만 14세 미만 · 보상 제외', suspended: '보상 정지' };
  const reasonField = () => field('조치 사유', 'reason', { required: true, minLength: 2, maxLength: 1000, multiline: true });
  const idField = (label, name) => field(label, name, { required: true, maxLength: name === 'slug' ? 80 : 128 });
  const typeField = () => field('대상 종류', 'targetType', { choices: [['post', '글'], ['comment', '댓글']] });
  const hiddenField = () => field('조치', 'hidden', { choices: [['true', '숨기기'], ['false', '다시 공개하기']] });
  const resultCount = value => Array.isArray(value) ? value.length : Number.isSafeInteger(value) ? value : 0;
  function denied(error) {
    if (error.status !== 401 && error.status !== 403) return false;
    clear(); message(byId('admin-session'), '운영자만 이용할 수 있어요. 운영 계정으로 로그인했는지 확인해 주세요.', true); return true;
  }
  function clear() {
    authorized = false; generation++; byId('admin-content').hidden = true;
    for (const id of ['admin-reports', 'admin-hidden', 'admin-users', 'admin-bugs', 'admin-events', 'admin-issues']) byId(id).replaceChildren();
    for (const form of byId('admin-content').querySelectorAll('form')) form.reset();
    for (const node of byId('admin-content').querySelectorAll('.tool-result')) message(node, '');
  }
  function formFor(slot, { fields, label, path, transform = x => x, payload = x => x, success = () => '처리했어요.', refresh }) {
    const form = make('form', null, 'tools-form'); form.append(...fields);
    const result = make('p', '', 'tool-result'); result.hidden = true; result.setAttribute('role', 'status');
    const submit = make('button', label, 'primary-button'); submit.type = 'submit'; form.append(result, submit); slot.append(form);
    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!authorized || saving || !form.reportValidity()) return;
      let data;
      try { data = transform(Object.fromEntries(new FormData(form))); }
      catch (error) { message(result, error.message, true); return; }
      saving = true; const current = generation; busy(form, true); message(result, '처리하고 있어요.');
      try {
        const response = await request(typeof path === 'function' ? path(data) : path, payload(data));
        if (!authorized || current !== generation) return;
        message(result, success(response));
        if (refresh) await refresh();
      } catch (error) { if (!denied(error)) message(result, error.message, true); }
      finally { saving = false; busy(form, false); }
    });
    return form;
  }
  function record(container, title) { const node = make('article', null, 'tool-record'); if (title) node.append(make('h3', title)); container.append(node); return node; }
  function content(node, item) {
    detail(node, '대상 종류', item.targetType === 'comment' ? '댓글' : item.targetType === 'post' ? '글' : '');
    detail(node, '대상 ID', item.targetId || item.id); detail(node, '제목', item.title); detail(node, '내용', item.body);
  }
  async function load(kind) {
    if (!authorized) return; const current = generation;
    const config = { reports: ['/admin/reports', 'reports-result', 'admin-reports'], hidden: ['/admin/hidden', 'hidden-result', 'admin-hidden'], bugs: ['/admin/bug-reports', 'bugs-result', 'admin-bugs'], events: ['/admin/events', 'events-result', 'admin-events'], issues: ['/community/known-issues', 'issues-result', 'admin-issues'] }[kind];
    const [path, statusId, listId] = config; const status = byId(statusId), list = byId(listId);
    message(status, '목록을 확인하고 있어요.');
    try {
      const data = await request(path); if (!authorized || current !== generation) return; list.replaceChildren();
      if (kind === 'reports') {
        if (!Array.isArray(data.reports)) throw new Error('신고 응답을 확인하지 못했어요.');
        for (const item of data.reports) {
          const card = record(list, `신고 · ${item.reason || ''}`); detail(card, '신고 ID', item.id); detail(card, '설명', item.description); detail(card, '상태', ({ pending: '검토 대기', dismissed: '기각', resolved: '처리 완료' })[item.status] || '확인 필요'); detail(card, '접수', formatDate(item.createdAt));
          content(card, { ...(item.target || {}), targetType: item.targetType, targetId: item.targetId }); if (!item.target) detail(card, '대상 상태', '원문이 삭제되어 내용을 확인할 수 없어요.');
          formFor(card, { fields: [field('신고 조치', 'action', { choices: [['dismiss', '기각'], ['hide', '대상 숨기기'], ['unhide', '대상 다시 공개하기']] }), reasonField()], label: '신고 처리', path: `/admin/reports/${encodeURIComponent(item.id)}`, success: () => '신고를 처리했어요. 아래 새로고침으로 최신 상태를 확인할 수 있어요.' });
        }
        message(status, data.reports.length ? '' : '접수된 신고가 없어요.');
      } else if (kind === 'hidden') {
        if (!Array.isArray(data.posts) || !Array.isArray(data.comments)) throw new Error('숨김 목록을 확인하지 못했어요.');
        for (const [type, items] of [['post', data.posts], ['comment', data.comments]]) for (const item of items) {
          const card = record(list, type === 'post' ? '숨긴 글' : '숨긴 댓글'); content(card, { ...item, targetType: type }); detail(card, '숨김 시각', formatDate(item.hiddenAt));
          formFor(card, { fields: [reasonField()], label: '다시 공개하기', path: '/admin/content', transform: data => ({ ...data, targetType: type, targetId: item.id, hidden: false }), success: () => '다시 공개했어요. 목록을 새로고침하면 반영돼요.' });
        }
        message(status, data.posts.length + data.comments.length ? '' : '숨긴 글·댓글이 없어요.');
      } else if (kind === 'bugs') {
        if (!Array.isArray(data.reports)) throw new Error('제보 응답을 확인하지 못했어요.');
        for (const item of data.reports) {
          const card = record(list, item.title); detail(card, '제보 ID', item.id); detail(card, '제보자', item.user?.name); detail(card, '제보자 ID', item.user?.id); detail(card, '보상 자격', eligibility[item.rewardEligibility] || '확인 필요'); detail(card, '게임', ({ slimeline: '슬라임 라인', gyeongguk: '경국지계', site: '사이트', 'slime-race': '슬라임 레이스' })[item.game]); detail(card, '상태', item.status); detail(card, '접수', formatDate(item.createdAt)); detail(card, '문제 설명', item.body); detail(card, '재현 순서', item.steps); detail(card, '문제 주소', item.url);
          formFor(card, { fields: [field('처리 상태', 'status', { choices: ['접수', '확인 중', '중복', '재현 불가', '채택', '수정 완료'].map(value => [value, value]), value: item.status }), field('채택 등급', 'grade', { value: item.grade || '', choices: [['', '선택하지 않음'], ['simple', '단순 · 2,000 그레인'], ['normal', '일반 · 5,000 그레인'], ['critical', '중대 · 20,000 그레인']] }), reasonField()], label: '제보 상태 저장', path: `/admin/bug-reports/${encodeURIComponent(item.id)}`, transform: data => { if (data.status === '채택' && !data.grade) throw new Error('채택하려면 보상 등급을 선택해 주세요.'); if (!data.grade) delete data.grade; return data; }, success: response => `제보 상태를 저장했어요.${response.awarded ? ' 채택 보상을 지급했어요.' : ' 지급 여부는 서버의 자격·중복 기록에 따라 처리돼요.'}` });
        }
        message(status, data.reports.length ? '' : '접수된 버그 제보가 없어요.');
      } else if (kind === 'issues') {
        if (!Array.isArray(data.issues)) throw new Error('알려진 문제 응답을 확인하지 못했어요.');
        for (const item of data.issues) {
          const card = record(list, item.title); detail(card, '문제 ID', item.id); detail(card, '공개 상태', item.status);
          formFor(card, { fields: [field('공개 제목', 'title', { required: true, minLength: 2, maxLength: 100, value: item.title }), field('공개 요약', 'summary', { required: true, minLength: 10, maxLength: 2000, multiline: true, value: item.summary }), field('공개 상태', 'status', { choices: ['확인 중', '수정 중', '수정 완료'].map(value => [value, value]), value: item.status }), reasonField()], label: '공개 안내 수정', path: `/admin/known-issues/${encodeURIComponent(item.id)}`, success: () => '공개 안내를 수정했어요.' });
        }
        message(status, data.issues.length ? '' : '등록한 공개 안내가 없어요.');
      } else {
        if (!Array.isArray(data.events)) throw new Error('이벤트 응답을 확인하지 못했어요.');
        for (const item of data.events) { const card = record(list, item.title); detail(card, '식별자', item.slug); detail(card, '지급량', `${new Intl.NumberFormat('ko-KR').format(item.amount)} 그레인`); detail(card, '시작', formatDate(item.startsAt)); detail(card, '종료', formatDate(item.endsAt)); }
        message(status, data.events.length ? '' : '등록된 이벤트가 없어요.');
      }
    } catch (error) { if (!denied(error)) message(status, error.message, true); }
  }
  formFor(byId('content-form-slot'), { fields: [typeField(), idField('대상 글·댓글 ID', 'targetId'), hiddenField(), reasonField()], label: '숨김 상태 저장', path: '/admin/content', transform: data => ({ ...data, hidden: data.hidden === 'true' }), success: () => '숨김 상태를 저장했어요.', refresh: () => load('hidden') });
  formFor(byId('issue-form-slot'), { fields: [field('공개 제목', 'title', { required: true, minLength: 2, maxLength: 100 }), field('공개 요약', 'summary', { required: true, minLength: 10, maxLength: 2000, multiline: true }), field('공개 상태', 'status', { choices: ['확인 중', '수정 중', '수정 완료'].map(value => [value, value]) }), reasonField()], label: '알려진 문제 등록', path: '/admin/known-issues', success: () => '알려진 문제를 등록했어요. 공개 제보 창구의 목록에서 확인할 수 있어요.', refresh: () => load('issues') });
  formFor(byId('best-form-slot'), { fields: [idField('선정할 글 ID', 'postId'), reasonField()], label: '우수 글 선정·보상', path: '/admin/best-post', success: response => response.awarded ? '우수 글로 선정하고 3,000 그레인을 지급했어요.' : response.duplicate ? '이미 우수 글 보상을 받은 글이에요. 추가 지급하지 않았어요.' : `선정 요청을 처리했어요. 보상 자격: ${eligibility[response.rewardEligibility] || '확인 필요'}. 추가 지급하지 않았어요.` });
  formFor(byId('event-form-slot'), { fields: [field('이벤트 식별자', 'slug', { required: true, maxLength: 80, placeholder: '예: autumn-community', pattern: '[a-z0-9]+(-[a-z0-9]+)*' }), field('이벤트 이름', 'title', { required: true, minLength: 2, maxLength: 100 }), field('지급량 (1~100,000 그레인)', 'amount', { type: 'number', required: true, min: 1, max: 100000, step: 1 }), field('시작 시각', 'startsAt', { type: 'datetime-local', required: true }), field('종료 시각', 'endsAt', { type: 'datetime-local', required: true }), reasonField()], label: '이벤트 등록', path: '/admin/events', transform: data => { const start = new Date(data.startsAt), end = new Date(data.endsAt); if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error('종료 시각은 시작 시각보다 나중이어야 해요.'); return { ...data, amount: Number(data.amount), startsAt: start.toISOString(), endsAt: end.toISOString() }; }, success: () => '이벤트를 등록했어요.', refresh: () => load('events') });
  formFor(byId('award-form-slot'), { fields: [idField('등록한 이벤트 식별자', 'slug'), field('지급 대상 (최대 500명)', 'recipients', { required: true, multiline: true, maxLength: 128000 }), reasonField()], label: '이벤트 보상 지급', path: data => `/admin/events/${encodeURIComponent(data.slug)}/awards`, transform: data => { const recipients = data.recipients.trim().split(/[\s,;]+/).filter(Boolean); if (!recipients.length || recipients.length > 500) throw new Error('지급 대상은 1~500명으로 입력해 주세요.'); return { ...data, recipients }; }, payload: data => ({ recipients: data.recipients, reason: data.reason }), success: response => `지급 ${resultCount(response.awarded)}명 · 자격 제외 ${resultCount(response.skipped)}명 · 중복 ${resultCount(response.duplicates)}명 · 찾을 수 없음 ${resultCount(response.notFound)}명` });
  byId('user-search').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; if (!authorized || !form.reportValidity()) return; const current = generation; busy(form, true); byId('admin-users').replaceChildren(); message(byId('users-result'), '회원을 찾고 있어요.');
    try {
      const data = await request(`/admin/users?q=${encodeURIComponent(byId('user-query').value.trim())}`); if (!authorized || current !== generation) return;
      if (!Array.isArray(data.users)) throw new Error('회원 응답을 확인하지 못했어요.');
      for (const item of data.users) {
        const card = record(byId('admin-users'), item.name); detail(card, '회원 ID', item.id); detail(card, '보상 자격', eligibility[item.rewardEligibility] || '확인 필요'); detail(card, '잔액', `${new Intl.NumberFormat('ko-KR').format(item.balance)} 그레인`);
        formFor(card, { fields: [field('보상·레이스 이용 제한', 'suspended', { choices: [['true', '보상·레이스 정지'], ['false', '정지 해제']] }), reasonField()], label: '정지 상태 저장', path: `/admin/users/${encodeURIComponent(item.id)}/suspension`, transform: data => ({ ...data, suspended: data.suspended === 'true' }), success: () => '정지 상태를 저장했어요. 회원을 다시 검색하면 최신 자격을 확인할 수 있어요.' });
        formFor(card, { fields: [field('회수량 (남은 잔액 범위)', 'amount', { type: 'number', required: true, min: 1, step: 1, max: Number.MAX_SAFE_INTEGER }), reasonField()], label: '그레인 회수', path: `/admin/users/${encodeURIComponent(item.id)}/reclaim`, transform: data => ({ ...data, amount: Number(data.amount) }), success: response => `회수 요청을 처리했어요.${Number.isSafeInteger(response.reclaimed) ? ` 실제 회수 ${response.reclaimed.toLocaleString('ko-KR')} 그레인.` : ''} 회원을 다시 검색해 잔액·정지 상태를 확인해 주세요.` });
      }
      message(byId('users-result'), data.users.length ? `${data.users.length}명을 찾았어요.` : '정확히 일치하는 회원이 없어요.');
    } catch (error) { if (!denied(error)) message(byId('users-result'), error.message, true); }
    finally { busy(form, false); }
  });
  for (const button of document.querySelectorAll('[data-refresh]')) button.addEventListener('click', async () => { button.disabled = true; try { await load(button.dataset.refresh); } finally { button.disabled = false; } });
  async function session() {
    clear(); byId('admin-retry').disabled = true; message(byId('admin-session'), '운영 권한을 확인하고 있어요.');
    try { const data = await request('/admin/session'); if (data.admin !== true) { message(byId('admin-session'), '운영자만 이용할 수 있어요.'); return; } authorized = true; byId('admin-content').hidden = false; message(byId('admin-session'), '운영 권한을 확인했어요.'); await Promise.all(['reports', 'hidden', 'bugs', 'events', 'issues'].map(load)); }
    catch (error) { if (!denied(error)) message(byId('admin-session'), error.message, true); }
    finally { byId('admin-retry').disabled = false; }
  }
  byId('admin-retry').addEventListener('click', session); window.addEventListener('pagehide', clear); window.addEventListener('pageshow', event => { if (event.persisted) session(); });
  session();
})();
