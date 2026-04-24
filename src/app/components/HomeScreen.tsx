import { useState } from 'react';
import {
  ArrowRight,
  Compass,
  LoaderCircle,
  LogOut,
  MapPin,
  User,
  UserRound,
  Users,
} from 'lucide-react';
import { AuthUser } from '../lib/auth';
import { AuthMode } from './AuthSheet';

interface HomeScreenProps {
  currentUser: AuthUser | null;
  onCreateRoom: () => void | Promise<void>;
  onContinueAsGuest: () => void;
  onJoinRoom: (code: string) => void | Promise<void>;
  onOpenAuth: (mode: AuthMode) => void;
  onOpenProfile: () => void;
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
  onOpenProfile,
  onSignOut,
  isOpeningRoom = false,
  roomError = null,
}: HomeScreenProps) {
  const [roomCode, setRoomCode] = useState('');

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f5f1eb] pb-28">
      <div className="pointer-events-none absolute left-1/2 top-28 h-96 w-96 -translate-x-1/2 rounded-full bg-[#ff7b6b]/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-20 h-80 w-80 rounded-full bg-[#5dd9d0]/12 blur-3xl" />

      <header className="fixed left-0 top-0 z-30 flex w-full items-center justify-between rounded-b-[2rem] bg-[#f5f1eb]/88 px-6 py-4 shadow-[0_10px_30px_rgba(26,26,46,0.08)] backdrop-blur-md">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1f2a44] text-white shadow-sm"
          aria-label="Drop"
        >
          <Compass className="h-5 w-5" />
        </button>
        <div className="absolute left-1/2 -translate-x-1/2 text-2xl font-black tracking-[-0.06em] text-[#1f2a44]">
          Drop
        </div>
        {currentUser ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenProfile}
              className="inline-flex h-10 max-w-[116px] items-center gap-2 rounded-full bg-white px-3 text-sm text-[#1f2a44] shadow-sm transition-transform active:scale-95"
            >
              <UserRound className="h-4 w-4 shrink-0 text-[#76777e]" />
              <span className="truncate">{currentUser.name}</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#76777e] shadow-sm"
              aria-label="로그아웃"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpenAuth('login')}
            className="h-10 rounded-full bg-white px-4 text-sm text-[#1f2a44] shadow-sm transition-transform active:scale-95"
          >
            로그인
          </button>
        )}
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 pt-28">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-8 flex h-32 w-32 items-center justify-center rounded-full border-4 border-white bg-[#ffc9c1] text-[#7a130f] shadow-[0_20px_55px_rgba(26,26,46,0.12)]">
            <MapPin className="h-16 w-16 fill-current" />
          </div>
          <h1 className="text-5xl font-black tracking-[-0.08em] text-[#1f2a44]">Drop</h1>
          <p className="mt-4 text-2xl font-bold tracking-[-0.06em] text-[#76777e]">
            어디서 볼지, 이제 뽑자.
          </p>
        </div>

        <section className="space-y-5">
          <button
            type="button"
            onClick={onContinueAsGuest}
            className="flex h-[72px] w-full items-center justify-center gap-4 rounded-[1.5rem] bg-[#1f2a44] px-5 text-xl font-extrabold tracking-[-0.04em] text-white shadow-[0_10px_30px_rgba(26,26,46,0.08)] transition-transform active:scale-95"
          >
            <User className="h-7 w-7 fill-current" />
            혼자 정하기
          </button>

          <button
            type="button"
            onClick={() => {
              void onCreateRoom();
            }}
            disabled={isOpeningRoom}
            className="flex h-[72px] w-full items-center justify-center gap-4 rounded-[1.5rem] bg-[#1f2a44] px-5 text-xl font-extrabold tracking-[-0.04em] text-white shadow-[0_10px_30px_rgba(26,26,46,0.08)] transition-transform active:scale-95 disabled:opacity-60"
          >
            {isOpeningRoom ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
            {!isOpeningRoom ? <Users className="h-7 w-7 fill-current" /> : null}
            방 만들기
          </button>

          <div className="flex items-center gap-4 py-1 opacity-55">
            <div className="h-px flex-1 bg-[#c6c6ce]" />
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[#76777e]">or</span>
            <div className="h-px flex-1 bg-[#c6c6ce]" />
          </div>

          <div className="relative rounded-[1.5rem] border border-[#e4e2e4]/70 bg-white p-2 shadow-[0_10px_30px_rgba(26,26,46,0.04)]">
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void onJoinRoom(roomCode);
                }
              }}
              placeholder="방 코드로 입장하기"
              className="h-14 w-full rounded-[1.15rem] border-0 bg-transparent pl-5 pr-16 text-lg text-[#1f2a44] outline-none placeholder:text-[#a3a6ad] focus:ring-0"
            />
            <button
              type="button"
              onClick={() => {
                void onJoinRoom(roomCode);
              }}
              disabled={isOpeningRoom}
              className="absolute bottom-2 right-2 top-2 flex w-14 items-center justify-center rounded-[1.1rem] bg-[#f0edf0] text-[#1f2a44] shadow-sm transition-transform active:scale-95 disabled:opacity-60"
              aria-label="방 코드 입장"
            >
              <ArrowRight className="h-6 w-6" />
            </button>
          </div>

          {roomError && (
            <div className="rounded-[1.25rem] border border-[#ffdad6] bg-[#fff5f2] px-4 py-3 text-sm text-[#a6392e]">
              {roomError}
            </div>
          )}
        </section>

        {!currentUser && (
          <div className="mt-6 flex items-center justify-center gap-3 text-sm text-[#76777e]">
            <button
              type="button"
              onClick={() => onOpenAuth('signup')}
              className="font-semibold text-[#1f2a44]"
            >
              회원가입
            </button>
            <span className="text-[#c6c6ce]">·</span>
            <button type="button" onClick={onContinueAsGuest}>
              임시로 시작
            </button>
          </div>
        )}
      </main>

    </div>
  );
}
