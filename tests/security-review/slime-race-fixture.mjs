// 브라우저 검수 전용 격리 서버다. 운영 진입점이나 배포 패키지에 포함하지 않는다.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../../server/app.js';
import { cookieFrom, registerAndLogin, request } from '../../test/account-helpers.js';

const folder = await mkdtemp(join(tmpdir(), 'gracekin-race-browser-'));
const mailbox = [];
const startsAt = Math.floor(Date.now() / 600000) * 600000;
let clock = startsAt + 10000, verifiedAdult = false;
let app, db;
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
try {
  app = await startServer({
    port: 0, dataDir: folder, now: () => clock,
    mailer: async mail => mailbox.push(mail), guardianReplyTo: 'support@example.test',
    slimeRaceAdultVerifier: () => verifiedAdult,
    rateLimit: { authMax: 200, readMax: 5000, writeMax: 500 },
  });
  db = new DatabaseSync(join(folder, 'community.sqlite'));
  const login = await registerAndLogin(app, mailbox, {
    name: '경주검수회원', email: 'race-browser@example.test',
    password: '격리경주검수-2026-비밀번호', ageBand: '14plus',
  });
  if (login.status !== 200) throw new Error('격리 계정 준비 실패');
  const userId = login.body.user.id, cookie = cookieFrom(login);
  // 쿠키는 부모 시험 프로세스와의 파이프로만 전달하며 결과 보고에는 출력하지 않는다.
  output({ origin: app.origin, cookie, startsAt });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    const command = JSON.parse(line);
    if (command.action === 'close') { output({ ok: true }); break; }
    if (command.action === 'adult') verifiedAdult = command.value === true;
    else if (command.action === 'time') clock = startsAt + command.elapsed;
    else if (command.action === 'round') {
      // 실제 승자·배당은 결과 단계에서만 시험 프로세스에 반환한다.
      if (clock < startsAt + 570000) throw new Error('결과 전 내부 승자 조회 금지');
    } else if (command.action !== 'ledger') throw new Error('지원하지 않는 검수 명령');
    const state = await request(app, '/api/slime-race/state');
    const me = await request(app, '/api/slime-race/me', { cookie });
    const history = await request(app, '/api/slime-race/history', { cookie });
    const ledger = db.prepare('SELECT eventId,amount,reason FROM grain_ledger WHERE userId=? ORDER BY createdAt,id').all(userId);
    output({ ok: true, state: state.body, me: me.body, history: history.body, ledger });
  }
} finally {
  db?.close();
  await app?.close();
  await rm(folder, { recursive: true, force: true });
}
