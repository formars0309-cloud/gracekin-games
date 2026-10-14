# Gracekin Games 사이트

`gracekingames.com`에 올리는 게임 모음 페이지다. 카드의 "바로 플레이"를 누르면 게임별 주소에서 설치 없이 바로 실행된다.

- 사업체: Gracekin Games(그레이스킨 게임즈)

## 주소 계획 (2026-10-14, 게임 주소는 장르 대신 게임 이름으로 정함)

| 주소 | 내용 | 연결 방법 |
| --- | --- | --- |
| `gracekingames.com`, `www` | 이 모음 페이지 | GitHub Pages (이 저장소, `CNAME`) |
| `slimeline.gracekingames.com` | 슬라임 라인 | GitHub Pages `squishy-parade` 저장소에 사용자 도메인 연결 |
| `gyeongguk.gracekingames.com` | 경국지계 | fly.io `gyeongguk` 앱에 인증서 추가(`fly certs add`) |

2026-10-14에 세 주소를 모두 연결했다. 옛 주소 `formars0309-cloud.github.io/squishy-parade`는 새 주소로 넘어가고, `gyeongguk.fly.dev`는 그대로 열린다.

## 제보·의견 받기

누구나 로그인 없이 보낼 수 있는 구글 설문지로 받는다(2026-10-14). 사업자 구글 계정의 드라이브에 설문지와 응답 스프레드시트 「Gracekin Games 버그 제보·의견(응답)」이 있다. 이메일은 수집하지 않는다. 경국지계는 게임 안의 '문제 신고'·'소감 남기기'로도 받는다.

## 남은 일

1. ~~가비아에서 `gracekingames.com`을 등록한다.~~ 2026-10-14 21:30(한국시간) 등록 완료. WHOIS 확인: 등록기관 Gabia, 만료 2027-10-14, 네임서버 `ns.gabia.co.kr`·`ns.gabia.net`·`ns1.gabia.co.kr`. 첫해 19,800원, 이후 연 26,400원(부가세 포함).
2. ~~가비아 DNS 설정~~ 2026-10-14 완료(레코드 7개).
   - 루트: A 레코드 `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `www`·`slimeline`: CNAME `formars0309-cloud.github.io.`
   - `gyeongguk`: CNAME `99yk63x.gyeongguk.fly.dev.`(`fly certs setup`이 알려 준 값)
3. ~~이 저장소를 GitHub에 올리고 Pages와 `CNAME`을 켠다.~~ 완료.
4. 슬라임 라인 공개 저장소(squishy-parade)의 `CNAME`(slimeline.gracekingames.com)은 다시 배포할 때도 지우지 않는다. 개인정보처리방침 주소가 바뀌었으니 Play 등록정보의 방침 URL도 고친다(남음).
5. ~~경국지계 연결~~ 완료. 서버에는 접속 출처(Origin) 검사가 없다. 새 주소는 저장 공간이 따로라 기존 플레이어도 새 손님으로 시작한다.
6. 사업자등록과 통신판매업 신고가 끝나면 아래 사업자 정보를 채운다: 상호, 대표자, 사업자등록번호, 통신판매업 신고번호, 연락처.

## 미리 보기

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```
