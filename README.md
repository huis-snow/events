# 길드 오락실

길드 이벤트에서 링크 하나로 함께 즐기는 실시간 웹 게임 모음입니다. 빌드 과정 없이 정적 HTML/CSS/JavaScript로 동작하며 GitHub Pages의 저장소 루트에서 배포합니다.

## 게임

- [다 같이 빙고](./bingo/) — 참가자마다 `1~50` 중 중복 없는 숫자 25개로 5×5 빙고판을 만들고, 방장이 `/주사위 50` 결과를 입력하면 모든 화면이 실시간으로 체크되는 게임

## 프로젝트 구조

```text
/
├── index.html                 # 전체 게임 허브
├── styles.css
├── favicon.svg
├── bingo/
│   ├── index.html             # 빙고 방 만들기·참가·게임 화면
│   ├── styles.css
│   ├── core.js                # 빙고 규칙과 순수 계산
│   ├── app.js                 # 화면 상태와 사용자 동작
│   ├── firebase-store.js      # 인증·Firestore 실시간 연동
│   ├── firebase-config.js     # 공개 Firebase 웹 앱 설정
│   └── tests/
├── firebase.json
├── firestore.rules
└── firestore.indexes.json
```

새 게임은 루트 아래 독립 폴더로 추가하고, 루트 `index.html`의 게임 선택 카드에서 연결합니다.

## 빙고 규칙

- 중앙 무료 칸 없이 25칸 모두 숫자를 입력합니다.
- 한 빙고판에서 같은 숫자는 두 번 사용할 수 없습니다.
- 가로 5줄, 세로 5줄, 대각선 2줄의 총 12줄을 계산합니다.
- 이미 나온 주사위 결과는 기록하지 않습니다.
- 기본 승리 조건은 3빙고이며 방을 만들 때 4빙고·5빙고도 선택할 수 있습니다.
- 같은 주사위 결과로 여러 명이 목표에 도달하면 모두 공동 우승입니다.
- 게임을 시작하면 참가자 빙고판이 잠기며, 방장만 호출 숫자 입력·취소·종료·초기화를 할 수 있습니다.

## 로컬 실행

ES 모듈과 Firebase SDK를 사용하므로 파일을 직접 열지 말고 정적 서버를 실행합니다.

```bash
npm run serve
```

```text
http://localhost:8000/
http://localhost:8000/bingo/
```

테스트는 Node.js 기본 테스트 러너만 사용합니다.

```bash
npm test
```

## Firebase

작은 도구함의 `dogoo-a697f` 프로젝트와 분리된 전용 프로젝트를 사용합니다.

- Firebase 프로젝트: `huis-snow-events`
- 웹 앱: `events-web`
- Firestore 리전: `asia-northeast3` (서울)
- 인증: 익명 로그인
- 컬렉션: `bingoRooms/{roomId}/players/{uid}`

Firebase 웹 설정은 프로젝트를 식별하는 공개 설정이며 서비스 계정 키가 아닙니다. 방장 권한은 방을 만든 브라우저의 익명 Firebase UID에 연결됩니다. 방장이 브라우저 사이트 데이터를 지우거나 시크릿 창을 닫으면 진행자 권한을 복구할 수 없으므로 실제 이벤트에서는 일반 브라우저 창을 사용하세요.

보안 규칙과 인증 설정을 다시 배포할 때는 Firebase CLI 로그인 후 다음 명령을 실행합니다.

```bash
npm run firebase:deploy
```

보안 규칙은 서버에서 다음을 강제합니다.

- 로그인된 익명 사용자만 무작위 8자리 코드를 아는 방을 직접 조회
- 방 목록 전체 조회 차단
- 방장만 게임 상태와 호출 숫자 변경
- 참가자는 대기실에서 자기 UID의 빙고판만 생성·수정
- 게임 시작 후 빙고판 변경 차단
- 1~50 범위, 25개 숫자, 중복 금지, 호출 기록 중복 금지 검증

## 배포 주소

GitHub Pages의 배포 원본을 `main` 브랜치의 `/ (root)`로 설정합니다.

```text
https://huis-snow.github.io/events/
```

