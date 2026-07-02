import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Copy, ExternalLink, MapPin, UsersRound } from 'lucide-react';

function getRoomCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('room')?.trim().toUpperCase() ?? '';
}

function getJoinUrl(roomCode: string) {
  const url = new URL(window.location.origin);

  url.pathname = '/';
  url.search = '';
  url.hash = '';

  if (roomCode) {
    url.searchParams.set('room', roomCode);
  }

  return url.toString();
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한 제한이 있는 브라우저에서는 아래 fallback을 사용한다.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}

export function InvitePage() {
  const [copied, setCopied] = useState(false);
  const roomCode = useMemo(() => getRoomCodeFromUrl(), []);
  const joinUrl = useMemo(() => getJoinUrl(roomCode), [roomCode]);

  useEffect(() => {
    document.title = roomCode ? `KoK 약속방 ${roomCode}` : 'KoK 약속방 초대';
  }, [roomCode]);

  const handleCopy = async () => {
    if (await copyText(window.location.href)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <main className="min-h-screen bg-[#f8fbf7] text-[#16241D]">
      <section className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <a href="/landing" className="flex items-center gap-3" aria-label="KoK 소개로 이동">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#ffd9d9] shadow-[0_10px_24px_rgba(18,184,134,0.2)]">
              <MapPin className="h-6 w-6 fill-[#8d1711] text-[#8d1711]" />
            </div>
            <div className="text-2xl font-black tracking-normal">KoK</div>
          </a>
          <a
            href="/landing"
            className="inline-flex h-10 items-center justify-center gap-1 rounded-full bg-white px-4 text-sm font-semibold text-[#5f6f6d] shadow-sm"
          >
            소개
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </header>

        <div className="flex flex-1 flex-col justify-center py-10">
          <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#5f6f6d] shadow-sm">
            <UsersRound className="h-4 w-4" />
            약속방 초대
          </div>

          <h1 className="text-4xl font-black leading-tight tracking-normal text-[#16241D]">
            같은 약속방에서
            <br />
            장소를 정해요.
          </h1>
          <p className="mt-4 text-base font-semibold leading-7 text-[#6f7d7b]">
            참여자 위치를 모아 KoK이 모두에게 부담이 적은 후보를 고릅니다.
          </p>

          <div className="mt-9 rounded-[1.75rem] border border-[#e6ece8] bg-white p-5 shadow-[0_16px_38px_rgba(20,35,29,0.08)]">
            <div className="text-sm font-semibold text-[#7a8684]">초대 코드</div>
            <div className="mt-2 rounded-2xl bg-[#f5f8f4] px-4 py-4 text-center font-mono text-3xl font-black tracking-wide text-[#16241D]">
              {roomCode || '준비 중'}
            </div>
            {!roomCode ? (
              <p className="mt-3 text-sm text-[#8a9492]">
                초대 코드가 없는 링크입니다. 홈에서 새 약속방을 만들 수 있어요.
              </p>
            ) : null}
          </div>

          <div className="mt-6 grid gap-3">
            <a
              href={joinUrl}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#16241D] px-5 text-base font-black text-white shadow-[0_14px_30px_rgba(20,35,29,0.18)] transition-transform active:scale-[0.98]"
            >
              약속방 참여하기
              <ArrowRight className="h-5 w-5" />
            </a>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#E4EFE9] bg-white px-5 text-sm font-bold text-[#16241D] shadow-sm transition-transform active:scale-[0.98]"
            >
              {copied ? (
                <CheckCircle2 className="h-4 w-4 text-[#22c55e]" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? '복사됨' : '초대 링크 복사'}
            </button>
          </div>
        </div>

        <footer className="flex justify-center gap-6 pb-4 text-sm font-semibold text-[#8a9492]">
          <a href="/privacy.html">개인정보처리방침</a>
          <a href="/support.html">지원</a>
        </footer>
      </section>
    </main>
  );
}
