# KoK - 랜덤 약속 장소 추천 앱

KoK는 여러 사람이 한 방에 모여 각자의 출발 위치를 등록하면, 모두가 이동하기 좋은 약속 장소를 추천하고 공정한 추첨 게임으로 최종 장소를 정하는 웹 앱입니다.

현재 데모 배포 주소: [https://kok-meet.vercel.app](https://kok-meet.vercel.app)

## 주요 기능

- 초대 링크 기반 온라인 방 참여
- 로그인하지 않은 초대 사용자의 회원가입 유도
- 내 위치 자동 등록 및 참가자별 출발지 관리
- 네이버 지도 기반 주소 검색, 좌표 표시, 후보 위치 확인
- 대중교통, 자동차 이동 시간 기반 후보 비교
- 시간대에 따른 장소 추천 보정
- 여러 참가자가 같은 화면을 보는 온라인 추첨 흐름
- 카드, 사다리, 룰렛 등 랜덤 게임 연출
- 사다리타기 막대 추가 및 선택 상태 실시간 공유
- 최종 당첨 장소와 참가자별 이동 경로 결과 화면 제공

## 기술 스택

- Frontend: React, Vite, TypeScript
- UI: Tailwind CSS, lucide-react, motion
- Backend/API: Vercel Serverless Functions
- Realtime/Auth/DB: Supabase
- Map/Search/Route: NAVER Maps, NAVER Local Search, NAVER Directions, ODsay
- AI 후보 생성: OpenAI 또는 Upstage
- Deployment: Vercel

## 프로젝트 구조

```text
api/                  Vercel API 라우트
src/app/              앱 화면, 컴포넌트, 훅, 도메인 로직
src/app/components/   Planner, Map, RandomDrawer 등 주요 UI
src/app/hooks/        후보 검색, 이동 경로, 주변 장소 훅
src/app/lib/          Supabase, Naver Map, meeting helper
supabase/             운영 DB에 적용할 SQL 스키마와 동기화 스크립트
public/               PWA manifest, service worker, 정적 리소스
```

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경변수 설정

`.env.example`을 참고해 `.env`를 만듭니다.

```bash
cp .env.example .env
```

필수 값:

- `VITE_NAVER_MAP_KEY_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

서버 API 기능에 필요한 선택 값:

- `NAVER_MAP_CLIENT_SECRET`
- `NAVER_SEARCH_CLIENT_ID`
- `NAVER_SEARCH_CLIENT_SECRET`
- `ODSAY_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `UPSTAGE_API_KEY`
- `UPSTAGE_MODEL`
- `UPSTAGE_API_BASE_URL`

### 3. Supabase 스키마 적용

Supabase SQL Editor에서 아래 SQL을 적용합니다.

```text
supabase/schema.sql
supabase/ready-vote-sync.sql
```

운영 DB에는 `meeting_rooms`, `meeting_room_participants`의 최신 컬럼이 모두 있어야 온라인 방, 레디, 추첨, 이동수단 동기화가 정상 동작합니다.

### 4. 개발 서버 실행

```bash
npm run dev
```

기본 주소는 Vite 설정에 따라 `http://localhost:5173`입니다.

### 5. 프로덕션 빌드

```bash
npm run build
```

## 배포

Vercel 프로젝트에 연결한 뒤 프로덕션 배포를 실행합니다.

```bash
vercel deploy --prod
```

현재 운영 alias는 `https://kok-meet.vercel.app`입니다.

## 운영 전 체크리스트

상용 서비스로 열기 전에는 아래 항목을 반드시 보강해야 합니다.

- Supabase RLS를 방 멤버, 소유자, 초대 토큰 기준으로 제한
- 참가자 위치 정보 조회/수정 권한을 최소 권한으로 분리
- AI, 지도, 교통 API 프록시에 사용자/방/IP 단위 rate limit 적용
- API 요청 크기 제한, abuse 로그, 비정상 호출 차단 정책 추가
- CSP, X-Frame-Options, Referrer-Policy 등 보안 헤더 적용
- `test`, `lint`, `typecheck`, 핵심 E2E를 CI에 연결
- `npm audit` 기준을 정하고 취약 dependency 업데이트
- Supabase 운영 스키마와 저장소 SQL 파일의 차이 정기 점검

## 개발 메모

- 온라인 추첨은 Supabase Realtime broadcast로 선택 상태를 공유합니다.
- 당첨 결과와 이동 경로는 방 상태에 저장해 참가자별 화면 차이를 줄입니다.
- 사다리타기에서 진행자가 추가한 막대는 같은 방 참가자에게 실시간으로 전달됩니다.
- 네이버 지도 표기는 지도 화면에서만 정상적으로 노출되어야 하며, 게임 화면 UI와 겹치지 않도록 관리합니다.

