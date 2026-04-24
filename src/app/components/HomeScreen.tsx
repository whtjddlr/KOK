import { useState } from 'react';
import { LoaderCircle, LogOut, Sparkles } from 'lucide-react';
import { AuthUser } from '../lib/auth';
import { AuthMode } from './AuthSheet';

interface HomeScreenProps {
  currentUser: AuthUser | null;
  onCreateRoom: () => void | Promise<void>;
  onContinueAsGuest: () => void;
  onJoinRoom: (code: string) => void | Promise<void>;
  onOpenAuth: (mode: AuthMode) => void;
  onSignOut: () => void;
  isOpeningRoom?: boolean;
  roomError?: string | null;
}

export function HomeScreen({
  currentUser,
  onCreateRoom,
  onContinueAsGuest,
  onJoinRoom,
  onOpenAuth,
  onSignOut,
  isOpeningRoom = false,
  roomError = null,
}: HomeScreenProps) {
  const [roomCode, setRoomCode] = useState('');

  return (
    <div className="flex min-h-screen flex-col bg-[#fafaf8]">
      <header className="flex items-center justify-end px-5 py-4">
        {currentUser ? (
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-white px-4 py-2 text-sm text-[#1a1a2e] shadow-sm">
              {currentUser.name}
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#6b7280] shadow-sm"
              aria-label="로그아웃"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpenAuth('login')}
            className="h-10 rounded-full bg-white px-4 text-sm text-[#1a1a2e] shadow-sm"
          >
            로그인
          </button>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-5 py-8">
        <div className="mb-8">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff7b6b] shadow-sm">
            <Sparkles className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-4xl font-semibold tracking-normal text-[#161a24]">랜덤밋</h1>
          <p className="mt-3 text-base leading-relaxed text-[#667085]">
            방을 만들고 위치를 넣으면 바로 시작합니다. 혼자 먼저 돌려봐도 되고,
            코드를 공유해서 친구를 초대해도 됩니다.
          </p>
        </div>

        <section className="rounded-2xl border border-[#e8edf3] bg-white p-4 shadow-sm">
          <button
            type="button"
            onClick={() => {
              void onCreateRoom();
            }}
            disabled={isOpeningRoom}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#1f2a44] px-5 text-white shadow-sm transition-transform active:scale-95 disabled:opacity-60"
          >
            {isOpeningRoom ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
            방 만들기
          </button>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#edf1f4]" />
            <span className="text-xs text-[#9ca3af]">또는</span>
            <div className="h-px flex-1 bg-[#edf1f4]" />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void onJoinRoom(roomCode);
                }
              }}
              placeholder="방 코드 입력"
              className="h-12 flex-1 rounded-xl border border-[#e6ebf0] bg-[#fbfaf8] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:border-[#cbd5e1] focus:ring-2 focus:ring-[#1f2a44]/10"
            />
            <button
              type="button"
              onClick={() => {
                void onJoinRoom(roomCode);
              }}
              disabled={isOpeningRoom}
              className="h-12 rounded-xl bg-[#eef4ff] px-5 text-sm text-[#2d5aa7] transition-transform active:scale-95 disabled:opacity-60"
            >
              참여
            </button>
          </div>

          {roomError && (
            <div className="mt-3 rounded-xl border border-[#ffd9cf] bg-[#fff5f2] px-4 py-3 text-sm text-[#c15b3d]">
              {roomError}
            </div>
          )}
        </section>

        {!currentUser && (
          <div className="mt-5 flex items-center justify-center gap-3 text-sm text-[#6b7280]">
            <button
              type="button"
              onClick={() => onOpenAuth('signup')}
              className="text-[#1f2a44]"
            >
              회원가입
            </button>
            <span>·</span>
            <button type="button" onClick={onContinueAsGuest}>
              임시로 시작
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
