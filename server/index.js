import { startServer } from './app.js';

try {
  const app = await startServer();
  console.log(`커뮤니티 서버가 시작되었습니다: ${app.origin}`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (closing) return;
    closing = true;
    try { await app.close(); } catch { process.exitCode = 1; }
  });
} catch (error) {
  // 오류 객체와 환경 변수에는 비밀키가 포함될 수 있으므로 출력하지 않습니다. OIDC_CLIENTS 형식 오류만 비밀값 없이 알려 줍니다.
  console.error(/^OIDC_CLIENTS/.test(error?.message) ? error.message : '서버를 시작하지 못했습니다. 포트·데이터 폴더·인증 환경 설정을 확인해 주세요.');
  process.exitCode = 1;
}
