# Gracekin Games 사이트

`gracekingames.com`의 게임 모음과 게임별 홈페이지, 커뮤니티를 관리한다. 대문에서 게임 홈페이지로 이동해 소개와 안내를 확인하고, **START**를 누르면 실제 게임이 열린다. 게임을 시작하기 전에 게임 화면이나 게임 자원을 불러오지 않는다.

- 사업체: Gracekin Games(그레이스킨 게임즈)

## 사이트 주소와 게임 진입 흐름

| 주소 | 내용 | 연결 방법 |
| --- | --- | --- |
| `gracekingames.com`, `www` | 게임 모음 대문 | GitHub Pages (이 저장소, `CNAME`) |
| `gracekingames.com/games/slimeline/` | 슬라임 라인 홈페이지 | 이 저장소 |
| `gracekingames.com/games/gyeongguk/` | 경국지계 홈페이지 | 이 저장소 |
| `gracekingames.com/community/?game=slimeline` | 슬라임 라인 커뮤니티 | 이 저장소 |
| `gracekingames.com/community/?game=gyeongguk` | 경국지계 커뮤니티 | 이 저장소 |
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

게임마다 게시판과 공식 안내를 분리한다. 슬라임 라인은 자유게시판(`free`)·공략과 팁(`guide`)·갤러리(`gallery`)·공지사항(`notice`), 경국지계는 자유게시판(`free`)·덱 연구(`deck`)·전략과 공략(`strategy`)·공지사항(`notice`)을 제공한다. `board`가 없으면 공지사항을 연다.

현재는 게시판 분류 이동, 제목·내용 검색, 공식 안내 읽기와 목록 복귀를 이용할 수 있다. 공식 안내는 게임별로 환영 안내(`post=welcome`), 시작 안내(`post=play-guide`), 제보 안내(`post=feedback`) 3개다. 예: `/community/?game=slimeline&board=notice&post=welcome`.

회원가입·로그인·사용자 글쓰기·댓글은 제공하지 않는다. 사용자 게시판에는 실제 공개된 글이 없다는 안내를 표시한다. 제보와 의견은 기존 구글 설문지로 보낸다. 게임별 개인정보처리방침과 문의 메일 `support@gracekingames.com`도 연결한다.

## 방문 통계 (2026-10-15)

Umami Cloud(무료 Hobby, 사이트 1개, 월 10만 이벤트, 6개월 보관)로 센다. 쿠키를 쓰지 않고 개인정보를 모으지 않는다. `data-domains`로 실제 도메인에서만 보내고, 브라우저의 추적 거부(Do Not Track) 설정은 따른다. 그래서 로컬 미리 보기에서는 기록이 남지 않는다.

- 방문: 주소 꼬리표까지 남는다. 채널별 링크에 `?ref=blog`, `?ref=threads`, `?ref=youtube`, `?ref=kakao`, `?ref=reddit`처럼 붙인다.
- 대문 → 게임 홈페이지: `homepage-slimeline`, `homepage-gyeongguk`(속성 `from` = `stage` 첫 화면 무대, `card-image`, `card-button`). 게임 실행 횟수와 구분한다.
- 게임 홈페이지 START → 실제 게임: `play-slimeline`, `play-gyeongguk`. 클릭 의도를 세며 실제 로딩 완료나 플레이 시간은 뜻하지 않는다.
- 제보 설문지 이동: `feedback-form`. 제출 완료 횟수는 뜻하지 않는다.
- 대문·게임별 홈페이지·커뮤니티에 같은 사이트 ID와 실제 도메인 제한, 추적 거부 설정을 적용한다.
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

## 미리 보기

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

게임별 페이지를 통합한 뒤 내부 링크·자산, START 이동, 게임 사전 실행 여부, 게임별 안내 분리와 민감정보 패턴을 확인한다.

```sh
python3 scripts/verify_site.py
```
