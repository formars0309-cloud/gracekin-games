# Gracekin Games 사이트

`gracekingames.com`의 슬라임 레이스 관람 화면, 게임별 홈페이지와 커뮤니티를 관리한다. 슬라임 라인과 경국지계는 Google Play 모바일 출시를 준비 중이며, 대문 아래 게임 소개·카드에서 공식 홈페이지로 이동해 소식을 확인할 수 있다. 각 홈페이지의 **웹에서 체험하기**를 누르면 웹 버전이 열리며, 체험 전에는 게임 화면이나 게임 자원을 불러오지 않는다.

- 사업체: Gracekin Games(그레이스킨 게임즈)

## 사이트 주소와 게임 진입 흐름

| 주소 | 내용 | 연결 방법 |
| --- | --- | --- |
| `gracekingames.com`, `www` | 게임 모음 대문 | GitHub Pages (이 저장소, `CNAME`) |
| `gracekingames.com/games/slimeline/` | 슬라임 라인 홈페이지 | 이 저장소 |
| `gracekingames.com/games/gyeongguk/` | 경국지계 홈페이지 | 이 저장소 |
| `gracekingames.com/community/?game=slimeline` | 슬라임 라인 커뮤니티 진입 | 같은 경로·쿼리·해시를 유지해 전용 Fly 커뮤니티로 이동 |
| `gracekingames.com/community/?game=gyeongguk` | 경국지계 커뮤니티 진입 | 같은 경로·쿼리·해시를 유지해 전용 Fly 커뮤니티로 이동 |
| `community.gracekingames.com/community/` | 운영 중인 커뮤니티 화면·회원·글·댓글 주소 | 전용 서버에서 화면과 API를 같은 출처로 제공 |
| `community.gracekingames.com/community/account-deletion/` | 공통 계정 삭제 안내 | 전용 서버에서 공개 안내 제공 |
| `slimeline.gracekingames.com` | 슬라임 라인 | GitHub Pages `squishy-parade` 저장소에 사용자 도메인 연결 |
| `gyeongguk.gracekingames.com` | 경국지계 | fly.io `gyeongguk` 앱에 인증서 추가(`fly certs add`) |

2026-10-14에 세 주소를 모두 연결했다. 옛 주소 `formars0309-cloud.github.io/squishy-parade`는 새 주소로 넘어가고, `gyeongguk.fly.dev`는 2026-10-15부터 웹 요청을 새 주소로 넘기고(301, 경로·쿼리 유지), WebSocket은 거절하며, 상태 확인 `/health`만 그대로 연다.

## 문서 안내

- 날짜별 결정·공개 배포·정책 기록(디자인·그레인·슬라임 레이스·계정 표시·커뮤니티·보호자 동의·방문 통계·남은 일): [docs/사이트-운영-기록.md](docs/사이트-운영-기록.md)
- 운영·검증 정본: [공통 계정 운영](docs/공통계정-운영.md), [커뮤니티 배포 기록](docs/커뮤니티-배포.md), [슬라임 레이스 검증](docs/슬라임-레이스-검증.md)
- 기획 정본: `docs/기획/`
- 독립 보안 검수와 브라우저 재현 스크립트: `tests/security-review/`

## 로컬 실행과 검증

Node.js는 **24.15.0 이상인 24.x 버전**이 필요하다(`package.json`의 `engines`: `>=24.15.0 <25`). 처음 저장소를 내려받은 환경에서는 의존성을 설치한 뒤 서버를 시작한다.

```sh
npm ci
npm start
```

기본 주소는 `http://127.0.0.1:8766`이다. 회원·세션·게시글·댓글·그레인 잔액과 지급·사용·취소 반환·정산 내역은 `.data/community.sqlite`에 저장되므로 서버를 다시 시작해도 유지된다. 개발용 세션 비밀값은 `.data/auth-secret`으로 관리되며 공개하거나 커밋하지 않는다. `HOST`, `PORT`, `DATA_DIR`로 로컬 실행 환경을 바꿀 수 있다.

```sh
npm test
```

GitHub Pages만으로는 회원가입·로그인·공유 글쓰기·댓글을 실행할 수 없다. 정적 파일만 열면 공식 안내를 읽을 수 있고, 회원 기능은 서버 연결 안내를 표시한다. 커뮤니티 도메인 전환과 공통 계정 서버는 2026-10-16 배포 완료했다. Resend를 통해 가입·인증·복구와 보호자 동의 회신을 처리한다. 만 14세 미만은 동의 승인을 거쳐 가입하며 커뮤니티 읽기만 허용한다. 검증 범위는 [배포 기록](docs/커뮤니티-배포.md)에서 확인할 수 있다.

정적 사이트 검증기는 위의 Node.js 서버 테스트와 별도이며, 실행하려면 **Python 3**가 설치되어 있어야 한다. 게임별 페이지를 통합한 뒤 내부 링크·자산, 스토어 준비 상태·웹 체험 이동, 게임 사전 실행 여부, 게임별 안내 분리와 민감정보 패턴을 확인한다.

```sh
python3 scripts/verify_site.py
```

검증기 자체의 회귀 테스트와 독립 HTTP 보안 검수(임시 DB·임시 포트)는 아래로 실행한다.

```sh
python3 -m unittest discover -s tests/security-review -p 'test_*.py'
node tests/security-review/review_http.mjs .
```
