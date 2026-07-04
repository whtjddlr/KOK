# KoK - 약속 장소 추천 서비스

여러 사람이 각자의 출발지를 입력하면 이동 부담을 비교해 약속 후보지를 추천하고, 온라인 랜덤 추첨으로 최종 장소를 정하는 모바일 중심 서비스입니다.

> "어디서 볼까?"를 각자 검색하고 조율하는 과정을 한 방에서 끝내는 것이 목표입니다.

## Overview

| 항목 | 내용 |
| --- | --- |
| 서비스 | 약속 장소 추천, 후보 비교, 온라인 추첨 |
| 배포 | [https://kok-meet.vercel.app](https://kok-meet.vercel.app) |
| 플랫폼 | 모바일 웹, PWA, iOS WebView 앱 대응 |
| 개발 범위 | 기획, UI/UX, 프론트엔드, 서버리스 API, Supabase 연동, 지도/AI API 연동 |
| 핵심 기술 | React, TypeScript, Vite, Supabase, Vercel, NAVER Maps, ODsay, GMS AI |

## Screenshots

<table>
  <tr>
    <td align="center">
      <img src="src/assets/landing/01-home.webp" width="210" alt="KoK 홈 화면" />
      <br />
      <sub>홈 / 방 만들기</sub>
    </td>
    <td align="center">
      <img src="src/assets/landing/03-participants.webp" width="210" alt="참가자 위치 등록 화면" />
      <br />
      <sub>참가자 위치 등록</sub>
    </td>
    <td align="center">
      <img src="src/assets/landing/02-map.webp" width="210" alt="지도 후보 화면" />
      <br />
      <sub>지도 후보 비교</sub>
    </td>
    <td align="center">
      <img src="src/assets/landing/06-result.webp" width="210" alt="결과 화면" />
      <br />
      <sub>최종 결과</sub>
    </td>
  </tr>
</table>

## Problem

친구들과 약속 장소를 정할 때는 보통 아래 과정이 반복됩니다.

- 각자 출발지가 달라 중간 지점을 찾기 어렵다.
- 지도 앱에서 장소와 이동 시간을 따로 확인해야 한다.
- 한 명에게 이동 부담이 몰려도 체감하기 전까지 알기 어렵다.
- 후보가 많아지면 최종 선택이 감정적으로 흐르기 쉽다.

KoK는 이 과정을 "출발지 수집 -> 후보 추천 -> 이동 부담 비교 -> 랜덤 추첨" 흐름으로 단순화했습니다.

## Solution

- 초대 링크로 같은 약속방에 참가자를 모읍니다.
- 참가자별 출발지와 이동수단을 저장합니다.
- 지도, 교통, AI API를 활용해 후보 지역과 주변 장소를 정리합니다.
- 이동 시간 편차와 접근성을 기준으로 공평한 후보를 좁힙니다.
- 레디 상태를 동기화하고, 카드/사다리/돌림판 추첨으로 최종 장소를 결정합니다.

## Key Features

### 온라인 약속방

- 초대 코드와 링크 기반 참여
- 로그인 사용자와 비회원 게스트 흐름 지원
- Supabase Realtime 기반 레디 상태, 추첨 선택 상태 동기화

### 위치와 이동 시간 비교

- 네이버 지도 기반 주소 검색과 지도 표시
- 참가자별 대중교통/자동차 이동 시간 비교
- ODsay와 NAVER API를 통한 실제 경로 기반 보정

### AI 후보 추천

- GMS AI, OpenAI, Upstage provider fallback 구조
- 후보 지역과 주변 장소를 AI로 재정렬
- AI 실패 시 휴리스틱 후보 로직으로 fallback

### 모바일 UI/UX

- 모바일 safe area와 긴 텍스트 overflow 대응
- 한 화면에서 주요 행동이 보이도록 CTA와 하단 액션 영역 정리
- App Store 심사 대응을 위한 실제 사용 흐름 중심 화면 구성

## My Contributions

- 전체 서비스 플로우 설계와 모바일 우선 UI 구현
- React 컴포넌트 구조화와 상태 흐름 정리
- Supabase Auth, DB, Realtime 기반 온라인 방 기능 구현
- Vercel Serverless Functions로 지도/교통/AI API 프록시 구성
- GMS AI OpenAI-compatible gateway 연동
- Playwright 기반 모바일 UI 회귀 테스트 작성
- App Store 제출용 스크린샷과 WebView 앱 대응

## Architecture

```text
Client
  React / Vite / TypeScript
  지도 UI, 참가자 입력, 후보 비교, 추첨 UI

Serverless API
  Vercel Functions
  AI 후보 생성, 장소 추천, 경로/검색 API 프록시

Data / Realtime
  Supabase Auth
  Supabase Database
  Supabase Realtime broadcast

External APIs
  NAVER Maps / Local Search / Directions
  ODsay Transit
  GMS AI / OpenAI / Upstage
```

## Tech Stack

| 영역 | 기술 |
| --- | --- |
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS, lucide-react, motion |
| Backend | Vercel Serverless Functions |
| Auth / DB / Realtime | Supabase |
| Map / Route | NAVER Maps, NAVER Local Search, NAVER Directions, ODsay |
| AI | GMS AI, OpenAI, Upstage |
| QA | Playwright |
| Deploy | Vercel |

## Implementation Highlights

### 1. AI Provider Fallback

운영 환경에 설정된 provider를 순서대로 시도하고, 실패하면 다음 provider 또는 휴리스틱 로직으로 fallback합니다.

1. 앱 내 런타임 AI 설정
2. GMS AI
3. OpenAI `gpt-4o`
4. Upstage `solar-pro3`
5. 휴리스틱 후보 로직

GMS는 아래 OpenAI 호환 엔드포인트로 호출합니다.

```env
GMS_AI_API_BASE_URL=https://gms.ssafy.io/gmsapi/
GMS_AI_MODEL=gpt-4o
```

서버 내부에서는 다음 경로로 변환합니다.

```text
https://gms.ssafy.io/gmsapi/api.openai.com/v1/chat/completions
```

### 2. 온라인 추첨 동기화

- 방 참가자의 레디 상태를 Supabase에 저장합니다.
- 진행자가 선택한 추첨 슬롯과 사다리 막대 상태를 같은 방 참가자에게 공유합니다.
- 최종 결과와 경로 snapshot을 저장해 참가자별 화면 차이를 줄였습니다.

### 3. 모바일 UI 회귀 테스트

긴 지명, 주차장 정보, 하단 고정 버튼, 작은 화면 overflow를 Playwright로 검증합니다.

```bash
npm run qa:ui
```

현재 UI 회귀 테스트는 모바일 390px, 모바일 504px, 데스크톱 뷰포트에서 주요 화면을 확인합니다.

## Project Structure

```text
api/                  Vercel API 라우트
public/               PWA manifest, service worker, 앱 아이콘
src/app/              앱 화면, 컴포넌트, 훅, 도메인 로직
src/app/components/   Home, Planner, Map, RandomDrawer, Result 등 주요 UI
src/app/hooks/        후보 검색, 이동 경로, 주변 장소 추천 훅
src/app/lib/          Supabase, 지도, AI, 약속 장소 계산 로직
src/assets/landing/   README와 랜딩 페이지용 서비스 캡처 이미지
supabase/             운영 DB 스키마와 동기화 SQL
tests/ui/             Playwright UI 회귀 테스트
```

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

필수 환경변수:

- `VITE_NAVER_MAP_KEY_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

서버 기능용 환경변수:

- `SUPABASE_SERVICE_ROLE_KEY`
- `NAVER_MAP_CLIENT_SECRET`
- `NAVER_SEARCH_CLIENT_ID`
- `NAVER_SEARCH_CLIENT_SECRET`
- `ODSAY_API_KEY`
- `GMS_AI_API_KEY`
- `GMS_AI_MODEL`
- `GMS_AI_API_BASE_URL`

실제 키는 `.env`와 Vercel Environment Variables에만 저장합니다.

## Validation

```bash
npm run build
npm run qa:ui
```

- `npm run build`: Vite 프로덕션 빌드
- `npm run qa:ui`: 주요 화면 UI 회귀 테스트

## Deployment

```bash
vercel deploy --prod
```

운영 alias:

[https://kok-meet.vercel.app](https://kok-meet.vercel.app)

## What I Learned

- WebView 기반 앱도 App Store 심사에서 통과하려면 웹페이지 래핑이 아니라 앱다운 사용 흐름과 완성도가 중요하다.
- 지도/교통/AI API는 실패 가능성이 높기 때문에 provider fallback과 휴리스틱 fallback이 필요하다.
- 모바일에서는 기능보다도 텍스트 overflow, safe area, CTA 위치 같은 작은 UX 문제가 완성도를 크게 좌우한다.
- 실시간 협업 흐름은 "누가 진행자인지", "누가 레디했는지", "결과가 언제 확정됐는지"를 명확히 저장해야 화면 불일치를 줄일 수 있다.

## Next Steps

- 네이티브 iOS 기능 강화: 푸시 알림, 딥링크, 오프라인 오류 화면
- 후보 추천 품질 개선: 장소 카테고리 필터와 리뷰 기반 ranking 고도화
- 비용 제어: AI/지도 API rate limit과 캐싱 추가
- 운영 안정성: Supabase RLS 세분화와 API abuse 로그 추가
