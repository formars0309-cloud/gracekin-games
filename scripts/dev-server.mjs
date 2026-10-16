// 로컬 통합 확인용 공통 계정 서버. 실제 메일을 보내지 않고 가입 확인 메일만 같은 서버에 바로 확인 요청한다.
// 메일 본문·확인 링크·토큰은 출력하거나 파일로 남기지 않는다. 운영 환경에서는 실행하지 않는다.
//   OIDC_CLIENTS='[...]' node scripts/dev-server.mjs
import http from 'node:http';
import { startServer } from '../server/app.js';

if (process.env.NODE_ENV === 'production' || process.env.FLY_APP_NAME) {
  console.error('로컬 개발용 서버입니다. 운영 환경에서는 실행하지 않습니다.');
  process.exit(1);
}
const host = process.env.HOST ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error('로컬 개발용 서버는 루프백 주소에서만 실행합니다.');
  process.exit(1);
}

let app;
function confirmLocally(token) {
  // 가입 요청의 응답이 끝난 뒤 같은 서버의 확인 API로 보낸다.
  setTimeout(() => {
    const body = JSON.stringify({ token });
    const req = http.request({ hostname: host === 'localhost' ? '127.0.0.1' : host, port: app.port, path: '/api/account/verify-email', method: 'POST', headers: { host: new URL(app.origin).host, origin: app.origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      res.resume();
      console.log(res.statusCode === 200 ? '로컬 가입 확인 완료: 이제 로그인할 수 있습니다.' : '로컬 가입 확인 실패: 인증 메일 다시 받기를 눌러 주세요.');
    });
    req.on('error', () => console.log('로컬 가입 확인 실패: 인증 메일 다시 받기를 눌러 주세요.'));
    req.end(body);
  }, 300);
}
async function mailer(message) {
  const match = /#token=([A-Za-z0-9_-]{43})/.exec(message.text || '');
  if (message.subject === '그레이스킨게임즈 이메일 확인' && match) { confirmLocally(match[1]); return; }
  console.log(`로컬 개발: '${message.subject}' 메일은 보내지 않았습니다.`);
}

try {
  app = await startServer({ mailer, guardianReplyTo: 'local-guardian@example.test', port: process.env.PORT ?? 8766, host });
  console.log(`로컬 공통 계정 서버: ${app.origin}`);
  console.log(`발견 문서: ${app.origin}/.well-known/openid-configuration`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
} catch (error) {
  // 오류 객체에는 비밀값이 섞일 수 있으므로 OIDC_CLIENTS 형식 오류(비밀값 미포함)만 그대로 보여 준다.
  console.error(/^OIDC_CLIENTS/.test(error.message) ? error.message : '서버를 시작하지 못했습니다. 포트·데이터 폴더·환경 설정을 확인해 주세요.');
  process.exitCode = 1;
}
