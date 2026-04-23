import { ReactNode } from 'react';
import { LogOut, MapPin, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { AuthUser } from '../lib/auth';
import { AuthMode } from './AuthSheet';

interface HomeScreenProps {
  currentUser: AuthUser | null;
  onCreateRoom: () => void;
  onContinueAsGuest: () => void;
  onOpenAuth: (mode: AuthMode) => void;
  onSignOut: () => void;
}

export function HomeScreen({
  currentUser,
  onCreateRoom,
  onContinueAsGuest,
  onOpenAuth,
  onSignOut,
}: HomeScreenProps) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-[#fafaf8] via-[#f5f1eb] to-[#e8dfd0]">
      <div className="flex items-center justify-end px-6 py-5">
        {currentUser ? (
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-white/90 px-4 py-2 text-sm text-[#1a1a2e] shadow-sm">
              {currentUser.name}님
            </div>
            <button
              onClick={onSignOut}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#6b7280] shadow-sm"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => onOpenAuth('login')}
              className="h-10 rounded-full bg-white/90 px-4 text-sm text-[#1a1a2e] shadow-sm"
            >
              로그인
            </button>
            <button
              onClick={() => onOpenAuth('signup')}
              className="h-10 rounded-full bg-[#1f2a44] px-4 text-sm text-white shadow-sm"
            >
              회원가입
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-[#ff7b6b] to-[#ff9b8b] shadow-lg">
          <Sparkles className="h-12 w-12 text-white" />
        </div>

        <h1 className="mb-3 text-center text-4xl text-[#1a1a2e]">랜덤밋</h1>
        <p className="mb-10 max-w-sm text-center text-lg text-[#6b7280]">
          약속 장소 정하기 어려울 때,
          <br />
          후보를 먼저 고르고 랜덤으로 확정해요.
        </p>

        <div className="mb-10 w-full max-w-md space-y-4">
          <FeatureCard
            icon={<MapPin className="h-6 w-6 text-[#4ecdc4]" />}
            title="공통 범위 안에서만 추리기"
            description="위치와 이동 가능 범위를 보고 갈 수 있는 지역만 먼저 남겨요."
          />
          <FeatureCard
            icon={<Sparkles className="h-6 w-6 text-[#ff7b6b]" />}
            title="마지막까지 긴장감 있는 랜덤"
            description="후보를 압축한 뒤 마지막에 확정되는 랜덤 뽑기 흐름이에요."
          />
          <FeatureCard
            icon={<Users className="h-6 w-6 text-[#ffd166]" />}
            title="회원가입하면 친구 저장"
            description="자주 만나는 친구 위치를 저장해 두고 다음엔 바로 추가할 수 있어요."
          />
        </div>

        <button
          onClick={currentUser ? onCreateRoom : onContinueAsGuest}
          className="h-14 w-full max-w-md rounded-2xl bg-gradient-to-r from-[#2d3561] to-[#3d4575] text-white shadow-lg transition-transform active:scale-95"
        >
          {currentUser ? '방 만들기' : '게스트로 시작'}
        </button>

        {!currentUser && (
          <>
            <button
              onClick={() => onOpenAuth('signup')}
              className="mt-4 h-12 w-full max-w-md rounded-2xl bg-white/85 text-sm text-[#1a1a2e] shadow-sm transition-transform active:scale-95"
            >
              회원가입하고 친구 저장
            </button>
            <button
              onClick={() => onOpenAuth('login')}
              className="mt-4 text-sm text-[#6b7280]"
            >
              이미 계정이 있나요? 로그인
            </button>
          </>
        )}

        {currentUser && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-xs text-[#44505b] shadow-sm">
            <ShieldCheck className="h-4 w-4 text-[#22c55e]" />
            저장 친구와 설정이 이 계정 기준으로 유지돼요.
          </div>
        )}
      </div>

      <div className="p-6 text-center text-xs text-[#9ca3af]">v1.3.0 · 게스트 모드 지원</div>
    </div>
  );
}

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="flex gap-4 rounded-2xl bg-white/80 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[#fafaf8]">
        {icon}
      </div>
      <div className="flex-1">
        <h3 className="mb-1 text-[#1a1a2e]">{title}</h3>
        <p className="text-sm text-[#6b7280]">{description}</p>
      </div>
    </div>
  );
}
