# 체리 가계부 — Google 로그인 / 허용 계정 전용

프로젝트: fluent-sprite-509500-c0
소스 저장소: https://github.com/excude/expense_tracker (Public)
배포 예정 주소: https://excude.github.io/expense_tracker/

Firebase Spark + GitHub Pages + Firestore + Google 로그인 + Apps Script 구성입니다. 결제계정, Cloud Run, Functions, Storage는 필요 없습니다. 무료 할당량 안에서 운영합니다. 아직 실제 프로젝트에 배포/연결 테스트하지 않았습니다.

## 1. Google 로그인 활성화
Firebase 콘솔 → Authentication → 로그인 방법 → Google → 사용 설정 → 지원 이메일 선택 → 저장.
이메일/비밀번호 로그인은 이 버전에서 사용하지 않습니다. 이전에 켰다면 꺼도 됩니다.
Authentication → 설정 → 승인된 도메인에서 excude.github.io 를 추가하세요. 경로 /expense_tracker/ 또는 https://는 넣지 않습니다. config.js의 authDomain은 기존 firebaseapp.com 값을 유지합니다.
로그인은 Chrome/Safari 등 일반 브라우저에서 진행하세요. 앱 내부 브라우저는 Google 로그인을 제한할 수 있습니다.

## 2. Firestore와 허용 목록
Firestore Database를 Standard / 기본 데이터베이스 (default) / 프로덕션 모드로 생성합니다.
규칙 탭에 firestore.rules를 붙여 넣고 게시하거나 아래 배포 명령을 실행합니다. 공개 테스트 규칙은 사용하지 마세요.

Firestore → 데이터 → 컬렉션 시작:
- 컬렉션 ID: `access`
- 문서 ID: 허용할 Google 계정의 **전체 이메일을 소문자**로 입력 (예: name@gmail.com)
- 필드 `enabled`: boolean 타입, `true`
- 필드 `role`: string 타입, 본인은 `editor`, 조회만 허용할 사람은 `viewer`

본인 이메일부터 등록하세요. 다른 사람은 같은 컬렉션 안에 이메일별 문서를 추가하면 됩니다.
차단하려면 해당 문서를 삭제하거나 enabled를 false로 바꿉니다. 다음 서버 접근부터 거절되며 접속 중 화면은 권한 문서 변경을 수신하면 초기화됩니다. 이미 열람/다운로드한 정보까지 회수하지는 못합니다.

허용 목록은 **콘솔에서 프로젝트 관리자만** 관리합니다. 웹사이트에서는 자신을 허용하거나 역할을 수정할 수 없습니다. Google 로그인 자체는 가능해도 허용 문서가 없으면 사용 내역은 거절됩니다. Firebase Authentication 사용자 목록에 보인다는 사실은 접근 허용을 뜻하지 않습니다.

모든 허용 계정은 동일한 가계부를 봅니다. viewer는 조회만, editor는 업로드 및 이전 백업 정리도 가능합니다. 접근 규칙은 Google 제공자, 검증된 이메일, enabled 상태를 검사합니다. IAM 관리자/프로젝트 소유자는 별도 관리 권한으로 데이터에 접근할 수 있습니다.

## 3. GitHub Pages 배포
1. 공개 전 기존 저장소의 파일과 커밋 기록에 실제 .db 백업, 비밀번호, 토큰, 서비스 계정 비공개 키가 없는지 확인합니다. .gitignore는 이미 커밋된 파일이나 과거 기록을 지우지 않습니다.
2. 저장소 Settings → General → Danger Zone → Change repository visibility → Public.
3. ZIP 압축을 풀고 expense-tracker-free 폴더 **안의 내용**을 저장소 최상위에 올립니다. ZIP 자체나 바깥 폴더 전체를 올리지 마세요. public, bridge, tests, package.json, .github 등이 최상위에 있어야 합니다. 숨김 폴더 .github도 포함해야 합니다.
4. 기존 Cloud Run/Firebase Hosting 자동 배포 워크플로가 있으면 제거합니다. Pages 워크플로는 main 브랜치 기준입니다. 기본 브랜치가 다르면 .github/workflows/pages.yml의 branches를 수정하세요.
5. Settings → Pages → Build and deployment → Source에서 **GitHub Actions**를 선택합니다.
6. Actions → Deploy GitHub Pages → Run workflow → main → Run workflow. 이후 main에 변경 내용을 올리면 자동 배포됩니다.
7. 성공하면 https://excude.github.io/expense_tracker/ 에 접속합니다. Firebase 승인된 도메인에 excude.github.io를 추가해야 Google 로그인이 됩니다.

GitHub 배포용 별도 비밀번호나 Firebase 서비스 계정 키는 필요 없습니다. GitHub가 제공하는 기본 배포 권한을 사용합니다. 사이트에는 public 폴더만 배포됩니다. 단, 공개 저장소의 다른 소스도 누구나 열람할 수 있습니다.

게시한 Firestore 규칙과 access 목록은 그대로 사용합니다. Firebase Hosting 배포나 Cloud Shell 업로드는 필요 없습니다. Firestore의 인덱스 설정은 firestore.indexes.json을 참고하세요. chunks 컬렉션 그룹의 payload 필드는 조회 조건으로 사용하지 않으므로 단일 필드 인덱스에서 제외하는 것이 좋습니다. CLI 사용 시 `npx firebase-tools deploy --only firestore:indexes --project fluent-sprite-509500-c0`로 적용할 수 있습니다.

## 4. 드라이브 자동 동기화
일반 드라이브 폴더에서 `.db`가 보여야 합니다. 체리피커의 숨김 앱 데이터 폴더는 접근할 수 없습니다.

1. https://script.google.com/ 에서 프로젝트 생성. bridge/Code.gs 붙여 넣기.
2. 프로젝트 설정에서 appsscript.json 표시를 켜고 bridge/appsscript.json 내용을 반영.
3. 스크립트 속성에 아래 두 값 입력:
   - PROJECT_ID = fluent-sprite-509500-c0
   - BACKUP_FOLDER_ID = 드라이브 폴더 주소의 folders/ 뒤 값
4. **해당 Cloud 프로젝트를 관리하는 본인 Google 계정**으로 setup 실행, 권한 승인.
5. 최초 동기화 성공 후 약 15분 간격 syncDrive 트리거가 생성됩니다. 실행 내역에서 오류를 확인하세요.

이 버전은 Google OAuth를 이용하므로 비밀번호/API 키/갱신 토큰 속성을 입력하지 않습니다. 기존 스크립트를 교체한다면 AUTH_EMAIL, AUTH_PASSWORD, REFRESH_TOKEN, OWNER_UID, FIREBASE_API_KEY 속성을 삭제하세요.
자동 동기화는 Google OAuth 토큰을 사용하며 Firestore 보안 규칙 대신 **Google Cloud IAM**으로 허가됩니다. 실행 계정은 대상 프로젝트에 Firestore 데이터 접근 권한(예: Cloud Datastore User)이 있어야 합니다. 프로젝트 소유자는 보통 이미 권한이 있습니다. 사이트 조회자에게 IAM 권한을 줄 필요는 없습니다. 스크립트는 본인만 관리하고 웹앱으로 배포하지 마세요.

필요하면 Apps Script 프로젝트 설정에서 기존 Google Cloud 프로젝트의 **숫자 프로젝트 번호**로 연결하고 Drive API 및 OAuth 동의 화면을 설정합니다. 프로젝트 ID와 번호는 다릅니다. 기본 Apps Script Cloud 프로젝트 사용도 가능합니다. 권한 변경 시 setup을 다시 실행해 재승인하세요.

## 데이터 처리와 제한
- 백업 전체를 비공개 Firestore에 저장하고 브라우저가 카드 거래를 추출합니다. 백업의 카드 외 정보도 저장됩니다. 원본 DB는 GitHub에 올리지 마세요.
- 최대 6MiB. 조각과 현재 백업 포인터는 한 번에 저장해 실패 시 이전 백업을 유지합니다.
- 1일보다 오래된 이전 사본은 업로드/자동 동기화 시 정리합니다. 활성 사본은 유지됩니다.
- 같은 드라이브 파일은 중복 업로드하지 않습니다. 새 드라이브 백업이 수동 업로드보다 나중에 반영될 수 있습니다.
- 신용/체크카드, 숨김 제외, 취소 음수 반영. 월/카드/가맹점 검색. 실제 청구액/카드 실적과 다를 수 있습니다.
- 오프라인 데이터 저장을 켜지 않으며 로그아웃하면 화면의 내역을 초기화합니다.
- 6MiB 초과나 할당량 초과 시 동기화가 실패합니다. 무료 서비스는 무제한이 아닙니다.
- 이전 UID별 저장 버전을 실제 사용했다면 새 공유 경로 users/shared로 자동 이전하지 않습니다. 원본 백업을 다시 업로드하세요.

## 검증 범위
npm test: 거래 추출/필터/취소, 손상 파일, 조각 복원/용량, 규칙의 필수 조건 정적 검사, 동기화 원자적 요청과 중복 방지 모의 테스트.
실제 Google 로그인 및 배포된 보안 규칙의 통합 테스트는 아직 수행하지 않았습니다. 배포 후 허용 계정 조회, 미허용 계정 거절, viewer 업로드 거절을 확인하세요.

공식 문서:
https://firebase.google.com/docs/auth/web/google-signin
https://firebase.google.com/docs/firestore/use-rest-api
https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
