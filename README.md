# Gracekin Games 사이트

`gracekingames.com`의 게임 모음과 게임별 홈페이지, 커뮤니티를 관리한다. 대문에서 게임 홈페이지로 이동해 소개와 안내를 확인하고, **START**를 누르면 실제 게임이 열린다. 게임을 시작하기 전에 게임 화면이나 게임 자원을 불러오지 않는다.

- 사업체: Gracekin Games(그레이스킨 게임즈)

## 사이트 주소와 게임 진입 흐름

| 주소 | 내용 | 연결 방법 |
| --- | --- | --- |
| `gracekingames.com`, `www` | 게임 모음 대문 | GitHub Pages (이 저장소, `CNAME`) |
| `gracekingames.com/games/slimeline/` | 슬라임 라인 홈페이지 | 이 저장소 |
| `gracekingames.com/games/gyeongguk/` | 경국지계 홈페이지 | 이 저장소 |
| `gracekingames.com/community/?game=slimeline` | 슬라임 라인 커뮤니티 진입 | 같은 경로·쿼리·해시를 유지해 전용 Fly 커뮤니티로 이동 |
| `gracekingames.com/community/?game=gyeongguk` | 경국지계 커뮤니티 진입 | 같은 경로·쿼리·해시를 유지해 전용 Fly 커뮤니티로 이동 |
| `gracekin-games-community.fly.dev/community/` | 커뮤니티 화면·회원·글·댓글 | 전용 서버에서 화면과 API를 같은 출처로 제공 |
| `slimeline.gracekingames.com` | 슬라임 라인 | GitHub Pages `squishy-parade` 저장소에 사용자 도메인 연결 |
| `gyeongguk.gracekingames.com` | 경국지계 | fly.io `gyeongguk` 앱에 인증서 추가(`fly certs add`) |

2026-10-14에 세 주소를 모두 연결했다. 옛 주소 `formars0309-cloud.github.io/squishy-parade`는 새 주소로 넘어가고, `gyeongguk.fly.dev`는 2026-10-15부터 웹 요청을 새 주소로 넘기고(301, 경로·쿼리 유지), WebSocket은 거절하며, 상태 확인 `/health`만 그대로 연다.

## 디자인 (2026-10-14 확정)

- 홈: '달밤의 극장'. 첫 화면을 대표작 두 무대(슬라임 라인, 경국지계)로 나눈다. 마우스를 올린 무대가 넓어지고, 경국지계는 인물 얼굴을 중심으로 확대된다. 그 아래 '모든 게임' 카드 목록은 게임이 늘면 카드만 더한다.
- 로고: '달의 G'. 초승달이 G를 그리고, 반짝이는 별이 G의 가로획이 된다. 작은 별 하나를 더해 kin(함께)을 나타낸다.
- 색: 밤 #0C0A10, 자수정 #3B2552, 달빛 #E6C98A, 구리 #B0703F. 글꼴: Cormorant Garamond Italic, Cinzel, Noto Serif KR(Google Fonts).
- 그림: 경국지계 대표 그림은 게임 타이틀 화면의 배경과 두 인물을 한 장으로 합쳤다. 슬라임은 투명 배경 정면 그림이다.
- 공유 미리보기는 assets/og.jpg(1200×630), 아이콘은 assets/favicon.svg와 assets/apple-touch-icon.png다.

## 제보·의견 받기

누구나 로그인 없이 보낼 수 있는 구글 설문지로 받는다(2026-10-14). 사업자 구글 계정의 드라이브에 설문지와 응답 스프레드시트 「Gracekin Games 버그 제보·의견(응답)」이 있다. 이메일은 수집하지 않는다. 경국지계는 게임 안의 '문제 신고'·'소감 남기기'로도 받는다.

## 커뮤니티

현재 단계는 전용 Fly 회원 서버와 Pages 진입 경로의 연결 준비다. 실제 서버 배포·공유 검증 완료 여부는 [커뮤니티 배포 기록](docs/커뮤니티-배포.md)에 확정해 남긴다. 대문과 게임 홈페이지의 주소·DNS는 기존대로 유지한다.

게임마다 게시판과 공식 안내를 분리한다. 슬라임 라인은 자유게시판(`free`)·공략과 팁(`guide`)·갤러리(`gallery`)·공지사항(`notice`), 경국지계는 자유게시판(`free`)·덱 연구(`deck`)·전략과 공략(`strategy`)·공지사항(`notice`)을 제공한다. `board`가 없으면 공지사항을 연다.

게시판 분류 이동, 제목·내용 검색, 페이지 이동, 공식 안내 읽기와 목록 복귀를 이용할 수 있다. 공식 안내는 게임별로 환영 안내(`post=welcome`), 시작 안내(`post=play-guide`), 제보 안내(`post=feedback`) 3개다. 예: `/community/?game=slimeline&board=notice&post=welcome`.

만 14세 이상은 가입창의 확인 항목을 체크한 뒤 이메일·닉네임·비밀번호로 커뮤니티 계정을 만들고 로그인·로그아웃할 수 있다. 게임 계정과는 별도다. 비회원도 글을 읽을 수 있고, 로그인하면 일반 게시판에 글과 댓글을 작성하고 본인이 작성한 내용을 수정·삭제할 수 있다. 갤러리도 현재는 텍스트 글만 지원하며 사진·파일 첨부는 제공하지 않는다. 공식 공지는 기존 안내로 유지한다.

계정·세션·글·댓글은 서버의 실제 데이터베이스에 저장한다. 브라우저 저장소를 공용 게시판처럼 사용하지 않는다. 서버 연결이 끊기면 실패 안내와 입력 내용을 유지하고, 공식 안내는 계속 읽을 수 있다. 이메일 인증·비밀번호 재설정 메일은 현재 연결하지 않았다. 제보와 의견은 기존 구글 설문지로 보내며, 계정·글·댓글의 공통 방침은 `/community/privacy/`로 연결한다. 게임별 개인정보처리방침과 문의 메일 `support@gracekingames.com`도 유지한다. Fly 커뮤니티에서 대문·게임 홈페이지로 돌아가면 실제 `gracekingames.com` 주소가 열린다.

## 방문 통계 (2026-10-15)

Umami Cloud(무료 Hobby, 사이트 1개, 월 10만 이벤트, 6개월 보관)로 센다. 쿠키를 쓰지 않고 개인정보를 모으지 않는다. `data-domains`로 실제 도메인에서만 보내고, 브라우저의 추적 거부(Do Not Track) 설정은 따른다. 그래서 로컬 미리 보기에서는 기록이 남지 않는다.

- 방문: 주소 꼬리표까지 남는다. 채널별 링크에 `?ref=blog`, `?ref=threads`, `?ref=youtube`, `?ref=kakao`, `?ref=reddit`처럼 붙인다.
- 대문 → 게임 홈페이지: `homepage-slimeline`, `homepage-gyeongguk`(속성 `from` = `stage` 첫 화면 무대, `card-image`, `card-button`). 게임 실행 횟수와 구분한다.
- 게임 홈페이지 START → 실제 게임: `play-slimeline`, `play-gyeongguk`. 클릭 의도를 세며 실제 로딩 완료나 플레이 시간은 뜻하지 않는다.
- 제보 설문지 이동: `feedback-form`. 제출 완료 횟수는 뜻하지 않는다.
- 대문·게임별 홈페이지·커뮤니티에 같은 사이트 ID와 실제 도메인 제한, 추적 거부 설정을 적용한다. 현재 도메인 제한은 `gracekingames.com`이므로 Fly 기본 주소에서 열린 커뮤니티의 방문은 이 통계에 포함하지 않는다.
- 바닥글에 "방문 통계는 쿠키 없이, 누구인지 알 수 없는 형태로만 셉니다." 한 줄을 넣었다. 디자인 캔버스 HomeB에는 없는 줄이다.

## 남은 일

1. ~~가비아에서 `gracekingames.com`을 등록한다.~~ 2026-10-14 21:30(한국시간) 등록 완료. WHOIS 확인: 등록기관 Gabia, 만료 2027-10-14, 네임서버 `ns.gabia.co.kr`·`ns.gabia.net`·`ns1.gabia.co.kr`. 첫해 19,800원, 이후 연 26,400원(부가세 포함).
2. ~~가비아 DNS 설정~~ 2026-10-14 완료(레코드 7개).
   - 루트: A 레코드 `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `www`·`slimeline`: CNAME `formars0309-cloud.github.io.`
   - `gyeongguk`: CNAME `99yk63x.gyeongguk.fly.dev.`(`fly certs setup`이 알려 준 값)
   - 메일(2026-10-15): MX `mx1.improvmx.com.` 10, `mx2.improvmx.com.` 20, TXT `v=spf1 include:spf.improvmx.com ~all`. support@gracekingames.com은 ImprovMX가 전달한다.
3. ~~이 저장소를 GitHub에 올리고 Pages와 `CNAME`을 켠다.~~ 완료.
4. 슬라임 라인 공개 저장소(squishy-parade)의 `CNAME`(slimeline.gracekingames.com)은 다시 배포할 때도 지우지 않는다. 개인정보처리방침 주소가 바뀌었으니 Play 등록정보의 방침 URL도 고친다(남음).
5. ~~경국지계 연결~~ 완료. 운영 공개 주소는 `gyeongguk.gracekingames.com` 하나다(2026-10-15 경국지계 배포). 클라이언트 소스맵은 더 이상 공개되지 않는다.
6. 사업자등록과 통신판매업 신고가 끝나면 아래 사업자 정보를 채운다: 상호, 대표자, 사업자등록번호, 통신판매업 신고번호, 연락처.

## 로컬 실행과 검증

Node.js는 **24.15.0 이상인 24.x 버전**이 필요하다(`package.json`의 `engines`: `>=24.15.0 <25`). 처음 저장소를 내려받은 환경에서는 의존성을 설치한 뒤 서버를 시작한다.

```sh
npm ci
npm start
```

기본 주소는 `http://127.0.0.1:8766`이다. 회원·세션·게시글·댓글은 `.data/community.sqlite`에 저장되므로 서버를 다시 시작해도 유지된다. 개발용 세션 비밀값은 `.data/auth-secret`으로 관리되며 공개하거나 커밋하지 않는다. `HOST`, `PORT`, `DATA_DIR`로 로컬 실행 환경을 바꿀 수 있다.

```sh
npm test
```

GitHub Pages만으로는 회원가입·로그인·공유 글쓰기·댓글을 실행할 수 없다. 정적 파일만 열면 공식 안내를 읽을 수 있고, 회원 기능은 서버 연결 안내를 표시한다. 회원 서버와 Pages의 연결은 실제 배포·검증 후 공개 상태를 확정한다.

정적 사이트 검증기는 위의 Node.js 서버 테스트와 별도이며, 실행하려면 **Python 3**가 설치되어 있어야 한다. 게임별 페이지를 통합한 뒤 내부 링크·자산, START 이동, 게임 사전 실행 여부, 게임별 안내 분리와 민감정보 패턴을 확인한다.

```sh
python3 scripts/verify_site.py
```
