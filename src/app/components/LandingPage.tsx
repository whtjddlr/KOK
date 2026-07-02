import { useEffect } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  MapPin,
  Route,
  Share2,
  Shuffle,
  Smartphone,
  UsersRound,
} from 'lucide-react';
import homePreview from '../../../appstore-screenshots/final/01-home.png';
import mapPreview from '../../../appstore-screenshots/final/02-map.png';
import participantsPreview from '../../../appstore-screenshots/final/03-participants.png';
import resultPreview from '../../../appstore-screenshots/final/06-result.png';

const flowSteps = [
  {
    icon: MapPin,
    title: '출발지 입력',
    description: '각자 출발지를 저장하고 약속방에 참여합니다.',
  },
  {
    icon: Route,
    title: '후보 비교',
    description: '이동 시간과 접근성을 기준으로 후보지를 좁힙니다.',
  },
  {
    icon: Shuffle,
    title: '랜덤 추첨',
    description: '납득 가능한 후보 안에서 가볍게 최종 장소를 뽑습니다.',
  },
];

const features = [
  {
    icon: Clock3,
    title: '이동시간 비교',
    description: '누구 한 명만 멀어지지 않도록 예상 이동 시간을 함께 봅니다.',
  },
  {
    icon: Share2,
    title: '약속방 공유',
    description: '방 코드와 링크로 친구를 초대하고 같은 방에서 결과를 맞춥니다.',
  },
  {
    icon: CalendarDays,
    title: '주변 장소 확인',
    description: '결과 주변의 식사, 카페, 놀거리 후보까지 이어서 확인합니다.',
  },
];

const appStoreUrl = 'https://apps.apple.com/app/id6766378613';

function BrandMark() {
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#16241D] shadow-[0_12px_28px_rgba(20,35,29,0.16)]">
      <img src="/icons/kok-icon.svg" alt="" className="h-7 w-7" />
    </div>
  );
}

function PhonePreview({
  src,
  alt,
  className = '',
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[28px] border-[7px] border-[#16241D] bg-[#16241D] shadow-[0_28px_70px_rgba(20,35,29,0.22)] ${className}`}
    >
      <img src={src} alt={alt} className="block h-full w-full object-cover" loading="eager" />
    </div>
  );
}

export function LandingPage() {
  useEffect(() => {
    document.title = 'KoK - 친구들과 약속 장소 정하기';
  }, []);

  return (
    <div className="min-h-screen bg-[#f8fbf7] text-[#16241D]">
      <header className="fixed left-0 top-0 z-50 w-full border-b border-white/70 bg-[#f8fbf7]/86 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <a href="/landing" className="flex items-center gap-3" aria-label="KoK 소개 홈">
            <BrandMark />
            <span className="text-xl font-black tracking-normal">KoK</span>
          </a>

          <nav className="hidden items-center gap-7 text-sm font-bold text-[#667280] sm:flex">
            <a href="#flow" className="transition-colors hover:text-[#16241D]">
              사용 흐름
            </a>
            <a href="#features" className="transition-colors hover:text-[#16241D]">
              기능
            </a>
            <a href="#download" className="transition-colors hover:text-[#16241D]">
              시작하기
            </a>
          </nav>

          <a
            href="/"
            className="kok-pressable inline-flex h-11 items-center justify-center rounded-full bg-[#16241D] px-5 text-sm font-extrabold tracking-normal text-white shadow-[0_12px_28px_rgba(20,35,29,0.14)]"
          >
            앱 열기
          </a>
        </div>
      </header>

      <main>
        <section className="relative flex min-h-[760px] items-center overflow-hidden pt-16">
          <div className="absolute inset-0">
            <img
              src={mapPreview}
              alt=""
              className="h-full w-full object-cover opacity-28"
              loading="eager"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(248,251,247,0.76)_0%,rgba(248,251,247,0.92)_52%,#f8fbf7_100%)]" />
          </div>

          <svg
            viewBox="0 0 980 620"
            className="pointer-events-none absolute left-1/2 top-20 h-[620px] w-[980px] -translate-x-1/2 text-[#16241D]/18"
            aria-hidden="true"
          >
            <path
              d="M72 362c126-112 240-126 356-41 102 75 186 70 309-8 69-44 118-58 166-39"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray="10 18"
              strokeLinecap="round"
            />
            <path
              d="M166 210c108 32 180 90 229 176 44 77 108 113 193 104 77-9 133-55 184-127"
              fill="none"
              stroke="#0CA178"
              strokeWidth="6"
              strokeLinecap="round"
              opacity="0.52"
            />
            <circle cx="166" cy="210" r="14" fill="#12B886" />
            <circle cx="773" cy="362" r="14" fill="#ffd166" />
            <circle cx="494" cy="402" r="18" fill="#16241D" />
          </svg>

          <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-5 text-center">
            <div className="kok-screen-enter flex flex-col items-center">
              <div className="mb-7 flex h-24 w-24 items-center justify-center rounded-[16px] bg-white/88 shadow-[0_24px_70px_rgba(20,35,29,0.14)] backdrop-blur-md">
                <img src="/icons/kok-icon.svg" alt="" className="h-16 w-16" />
              </div>
              <h1 className="text-6xl font-black leading-none tracking-normal text-[#16241D] sm:text-7xl">
                KoK
              </h1>
              <p className="mt-6 max-w-[720px] text-3xl font-black leading-tight tracking-normal text-[#16241D] sm:text-5xl">
                친구들과 약속 장소를 더 짧고 가볍게 정하세요.
              </p>
              <p className="mt-5 max-w-[620px] text-lg font-semibold leading-8 tracking-normal text-[#667280]">
                출발지를 모으고, 이동 부담을 비교하고, 납득 가능한 후보 안에서 최종 장소를 뽑습니다.
              </p>
              <div className="mt-9 flex w-full max-w-[460px] flex-col gap-3 sm:flex-row sm:justify-center">
                <a
                  href="/"
                  className="kok-pressable inline-flex h-14 items-center justify-center rounded-full bg-[#16241D] px-7 text-base font-extrabold tracking-normal text-white shadow-[0_16px_36px_rgba(20,35,29,0.18)]"
                >
                  앱에서 시작하기
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
                <a
                  href="/"
                  className="kok-pressable inline-flex h-14 items-center justify-center rounded-full border border-[#E4EFE9] bg-white/88 px-7 text-base font-extrabold tracking-normal text-[#16241D] shadow-[0_12px_30px_rgba(20,35,29,0.06)] backdrop-blur-md"
                >
                  약속방 만들기
                </a>
              </div>
            </div>

            <div className="mt-16 grid w-full max-w-3xl grid-cols-3 gap-3 text-left">
              {['강남역', '홍대입구역', '성수'].map((place, index) => (
                <div
                  key={place}
                  className="rounded-[8px] border border-white/80 bg-white/76 p-3 shadow-[0_12px_34px_rgba(20,35,29,0.08)] backdrop-blur-md"
                  style={{ animationDelay: `${index * 70 + 120}ms` }}
                >
                  <div className="text-xs font-bold text-[#9AA8A1]">후보 {index + 1}</div>
                  <div className="mt-1 text-base font-black tracking-normal text-[#16241D]">
                    {place}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="flow" className="bg-[#f8fbf7] px-5 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-4xl font-black leading-tight tracking-normal text-[#16241D]">
                약속 장소 결정 흐름을 한 번에 정리합니다.
              </h2>
              <p className="mt-4 text-lg font-semibold leading-8 tracking-normal text-[#667280]">
                긴 대화 대신 앱 안에서 필요한 선택만 순서대로 처리합니다.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {flowSteps.map((step, index) => {
                const Icon = step.icon;

                return (
                  <article
                    key={step.title}
                    className="kok-pressable rounded-[8px] border border-[#e5ede8] bg-white p-6 shadow-[0_14px_38px_rgba(20,35,29,0.06)]"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-[#eef7f3] text-[#16241D]">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="mt-8 text-sm font-black text-[#12B886]">0{index + 1}</div>
                    <h3 className="mt-2 text-2xl font-black tracking-normal text-[#16241D]">
                      {step.title}
                    </h3>
                    <p className="mt-3 text-base font-semibold leading-7 tracking-normal text-[#667280]">
                      {step.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="overflow-hidden bg-white px-5 py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="text-4xl font-black leading-tight tracking-normal text-[#16241D]">
                앱 화면 그대로, 복잡한 설명 없이 바로 사용합니다.
              </h2>
              <p className="mt-5 text-lg font-semibold leading-8 tracking-normal text-[#667280]">
                참여자를 추가하고, 목적을 고르고, 후보를 확인한 뒤 결과를 공유하는 흐름이 한 화면씩 이어집니다.
              </p>
              <div className="mt-8 space-y-4">
                {['참여자 출발지 저장', '지도 위 후보 확인', '결과와 주변 장소 공유'].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-base font-extrabold">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0CA178]/18 text-[#16241D]">
                      <ArrowRight className="h-4 w-4" />
                    </span>
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:gap-5">
              <PhonePreview src={homePreview} alt="KoK 홈 화면" className="aspect-[1320/2868]" />
              <PhonePreview
                src={participantsPreview}
                alt="KoK 참여자 입력 화면"
                className="mt-12 aspect-[1320/2868]"
              />
              <PhonePreview
                src={resultPreview}
                alt="KoK 결과 화면"
                className="col-span-2 mx-auto aspect-[1320/2868] w-1/2 min-w-[160px]"
              />
            </div>
          </div>
        </section>

        <section id="features" className="bg-[#16241D] px-5 py-20 text-white">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr]">
              <div>
                <h2 className="text-4xl font-black leading-tight tracking-normal">
                  약속이 정해지는 마지막 순간까지 필요한 기능만 남겼습니다.
                </h2>
                <p className="mt-5 text-lg font-semibold leading-8 tracking-normal text-white/68">
                  이동 부담, 공유, 주변 장소 확인을 한 흐름 안에서 처리합니다.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {features.map((feature) => {
                  const Icon = feature.icon;

                  return (
                    <article
                      key={feature.title}
                      className="rounded-[8px] border border-white/12 bg-white/8 p-5"
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-white text-[#16241D]">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="mt-7 text-xl font-black tracking-normal">{feature.title}</h3>
                      <p className="mt-3 text-sm font-semibold leading-6 tracking-normal text-white/66">
                        {feature.description}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="download" className="bg-[#eef7f3] px-5 py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_0.85fr]">
            <div>
              <h2 className="text-4xl font-black leading-tight tracking-normal text-[#16241D]">
                다음 약속은 KoK에서 바로 시작하세요.
              </h2>
              <p className="mt-5 max-w-xl text-lg font-semibold leading-8 tracking-normal text-[#667280]">
                앱을 열고 새 약속방을 만들면 친구들과 같은 후보를 보면서 결정할 수 있습니다.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a
                  href={appStoreUrl}
                  className="kok-pressable inline-flex h-14 items-center justify-center rounded-full bg-[#16241D] px-7 text-base font-extrabold tracking-normal text-white shadow-[0_16px_36px_rgba(20,35,29,0.16)]"
                >
                  <Smartphone className="mr-2 h-5 w-5" />
                  App Store에서 받기
                </a>
                <a
                  href="/support.html"
                  className="kok-pressable inline-flex h-14 items-center justify-center rounded-full border border-[#d8e5de] bg-white px-7 text-base font-extrabold tracking-normal text-[#16241D]"
                >
                  지원 보기
                </a>
              </div>
            </div>

            <div className="rounded-[8px] border border-white/80 bg-white p-6 shadow-[0_18px_48px_rgba(20,35,29,0.08)]">
              <div className="flex items-center gap-4">
                <BrandMark />
                <div>
                  <div className="text-xl font-black tracking-normal text-[#16241D]">KoK</div>
                  <div className="text-sm font-bold text-[#9AA8A1]">친구들과 약속 장소 뽑기</div>
                </div>
              </div>
              <div className="mt-8 grid grid-cols-2 gap-3">
                <div className="rounded-[8px] bg-[#f8fbf7] p-4">
                  <UsersRound className="h-5 w-5 text-[#12B886]" />
                  <div className="mt-4 text-sm font-black text-[#16241D]">친구 초대</div>
                </div>
                <div className="rounded-[8px] bg-[#f8fbf7] p-4">
                  <MapPin className="h-5 w-5 text-[#0CA178]" />
                  <div className="mt-4 text-sm font-black text-[#16241D]">장소 추천</div>
                </div>
              </div>
              <div className="mt-7 flex flex-wrap gap-4 text-sm font-bold text-[#667280]">
                <a href="/privacy.html" className="hover:text-[#16241D]">
                  개인정보처리방침
                </a>
                <a href="/support.html" className="hover:text-[#16241D]">
                  지원
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
