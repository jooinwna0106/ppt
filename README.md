# 스피드 퀴즈쇼

PPT 퀴즈를 이미지 슬라이드로 업로드해 호스트 화면과 뷰어 화면을 실시간으로 동기화하는 버저 퀴즈 웹앱입니다.

## 실행

```bash
npm install
npm run dev
```

- 호스트/뷰어 시작 화면: http://localhost:5173/
- 같은 네트워크의 다른 기기에서 접속할 때는 개발 서버가 표시하는 `Network` 주소를 사용하세요.
- 서버는 http://localhost:4000 에서 Socket.io와 업로드 API를 제공합니다.

## 배포

이 앱은 Socket.io 실시간 서버와 이미지 업로드가 필요하므로 정적 호스팅만으로는 배포할 수 없습니다. Render, Railway, Fly.io, VPS, Docker 지원 호스팅처럼 Node 서버가 계속 실행되는 곳에 배포하세요.

일반 Node 호스팅 설정:

```bash
npm install
npm run build
npm start
```

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/healthz`
- Runtime: Node 20 이상

환경 변수:

```bash
PORT=4000
UPLOAD_DIR=./uploads
```

대부분의 호스팅은 `PORT`를 자동으로 넣어주므로 직접 설정하지 않아도 됩니다. 업로드된 슬라이드는 서버 파일 시스템의 `UPLOAD_DIR`에 저장됩니다. 무료/임시 파일 시스템을 쓰는 플랫폼에서는 재시작 후 업로드 파일이 사라질 수 있으니, 실제 행사에서 오래 보관해야 하면 영구 디스크가 있는 플랜이나 외부 스토리지를 사용하세요.

Docker 배포:

```bash
docker build -t speed-quiz-show .
docker run -p 4000:4000 -v speed-quiz-uploads:/app/uploads speed-quiz-show
```

## 진행 흐름

1. 호스트가 `방 만들기`를 누릅니다.
2. 뷰어 화면에서 방 코드를 입력하거나, 호스트 화면의 뷰어 링크를 복사해 엽니다.
3. 호스트가 PNG/JPG/WEBP/GIF 슬라이드 이미지를 여러 장 업로드합니다.
4. 호스트가 참가자 수, 이름, 배정 키를 설정합니다.
5. 호스트가 슬라이드를 넘기고 원하는 순간 `버저 활성화`를 누릅니다.
6. 뷰어 노트북의 키보드에서 참가자들이 배정 키를 누르면 순위가 기록됩니다.
7. 호스트가 `정답 +1` 또는 `오답 -1`로 판정합니다.
8. `퀴즈 종료`를 누르면 최종 순위와 시상식 화면이 표시됩니다.

## 현재 MVP 범위

- 방 생성/참가 및 실시간 상태 동기화
- 이미지 슬라이드 다중 업로드
- 참가자 2~8명 설정 및 중복 키 검증
- 슬라이드 이전/다음 이동
- 버저 활성/비활성, ms 기준 서버 수신 순위 기록
- 정답/오답 점수 처리와 다음 순위 답변권 이동
- 종료 시 최종 랭킹과 시상식 애니메이션

PPT 파일을 서버에서 자동 이미지 변환하는 기능은 아직 포함하지 않았습니다. 현재는 PowerPoint에서 슬라이드를 이미지로 내보낸 뒤 여러 장을 업로드하는 흐름을 지원합니다.
