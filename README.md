# Gracekin Games 사이트

`gracekingames.com`에 올리는 게임 모음 페이지다. 카드의 "바로 플레이"를 누르면 게임별 주소에서 설치 없이 바로 실행된다.

- 사업체: Gracekin Games(그레이스킨 게임즈)

## 주소 계획 (2026-10-14, 게임 주소는 장르 대신 게임 이름으로 정함)

| 주소 | 내용 | 연결 방법 |
| --- | --- | --- |
| `gracekingames.com`, `www` | 이 모음 페이지 | GitHub Pages (이 저장소, `CNAME`) |
| `slimeline.gracekingames.com` | 슬라임 라인 | GitHub Pages `squishy-parade` 저장소에 사용자 도메인 연결 |
| `gyeongguk.gracekingames.com` | 경국지계 | fly.io `gyeongguk` 앱에 인증서 추가(`fly certs add`) |

도메인이 연결되기 전까지 카드는 지금 주소를 가리킨다.
- 슬라임 라인: `formars0309-cloud.github.io/squishy-parade`
- 경국지계: `gyeongguk.fly.dev`

## 남은 일

1. ~~가비아에서 `gracekingames.com`을 등록한다.~~ 2026-10-14 21:30(한국시간) 등록 완료. WHOIS 확인: 등록기관 Gabia, 만료 2027-10-14, 네임서버 `ns.gabia.co.kr`·`ns.gabia.net`·`ns1.gabia.co.kr`. 첫해 19,800원, 이후 연 26,400원(부가세 포함).
2. 가비아 DNS를 설정한다.
   - 루트: A 레코드 `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `www`·`slimeline`: CNAME `formars0309-cloud.github.io`
   - `gyeongguk`: fly.io가 알려 주는 값
3. 이 저장소를 GitHub에 올리고 Pages와 `CNAME`을 켠다.
4. 슬라임 라인 배포에 `CNAME`(slimeline.gracekingames.com)이 매번 함께 올라가는지 확인한다. 개인정보처리방침 주소가 바뀌므로 Play 등록정보도 고친다.
5. 경국지계 서버가 접속 출처(Origin)를 검사하는지 확인한 뒤 새 주소를 연결한다.
6. 사업자등록과 통신판매업 신고가 끝나면 아래 사업자 정보를 채운다: 상호, 대표자, 사업자등록번호, 통신판매업 신고번호, 연락처.

## 미리 보기

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```
