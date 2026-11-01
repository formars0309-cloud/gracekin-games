# 그레이스킨게임즈 사이트 작업 규칙

- 조율자는 요구사항 정리, 작업 분담, 결과 검수, 검증, 통합을 책임진다. 구현은 작업자에게 위임한다.
- 모든 구현은 작업별 하위 브랜치와 별도 Orca 워크트리를 생성해 진행한다. `main`에서 직접 구현하지 않는다.
- 작업자 지시서에는 목적, 수정 범위, 검증 방법, 완료 기준을 명시한다. 조율자가 결과를 검수한 뒤 통합한다.
- 대화, 문서, 주석, 커밋 메시지는 한국어로 작성한다.
- 공개 발행·배포는 사용자가 명시적으로 요청했을 때만 검증 후 진행한다. `main` 푸시 등 통합 작업이 자동 배포를 유발하는지 먼저 확인한다.
- 비밀번호, 인증 코드, 토큰 등 비밀정보를 대화·로그·저장소에 노출하지 않는다. 커밋 전 변경에 맞는 검증과 민감정보 검사를 수행한다.
- 다른 작업자가 사용 중인 파일, 워크트리, 터미널은 건드리지 않는다.

- 아이디어·의견·시안 요청은 조사·제안·시안·검토 범위로 다룬다. 실제 코드·기능 구현은 사용자가 “구현하자” 등으로 명시적으로 요청했을 때만 진행한다.

## 실행·검증 경로

- 서버: `npm ci` 후 `npm start`(Node 24.x, `server/index.js`, 데이터는 `.data/`). 정적 화면은 GitHub Pages가 `main`을 그대로 게시하고, 같은 화면과 API를 Fly 앱 `gracekin-games-community`가 `Dockerfile`·`.dockerignore` 허용 목록으로 제공한다. 운영 파일을 추가하면 `.dockerignore` 허용 목록도 함께 고친다.
- 변경 전후 검증: `npm test`, `python3 scripts/verify_site.py`, `python3 -m unittest discover -s tests/security-review -p 'test_*.py'`, `node tests/security-review/review_http.mjs .`, `git diff --check`. 브라우저 재현 스크립트(`test/*-browser.mjs`, `tests/security-review/*_browser.py`)는 Playwright가 있는 환경에서만 수동 실행한다.
- 배포(`main` 푸시, `fly deploy`)는 조율자가 사용자 요청을 받아 한다. 작업자는 실행하지 않는다.
- 날짜별 결정·배포 기록은 `docs/사이트-운영-기록.md`와 `docs/커뮤니티-배포.md`에 쌓고, 이 파일에는 지속 규칙만 둔다.
