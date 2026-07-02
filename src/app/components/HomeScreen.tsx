import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Clock3,
  ExternalLink,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { AuthUser } from '../lib/auth';
import { AuthMode } from './AuthSheet';
import { MeetingRoom, MeetCategoryKey } from '../types';

interface HomeScreenProps {
  currentUser: AuthUser | null;
  onCreateRoom: () => void | Promise<void>;
  createdRooms?: MeetingRoom[];
  isLoadingCreatedRooms?: boolean;
  createdRoomsError?: string | null;
  deletingRoomIds?: string[];
  onRefreshRooms?: () => void | Promise<void>;
  onOpenExistingRoom?: (room: MeetingRoom) => void | Promise<void>;
  onDeleteExistingRoom?: (room: MeetingRoom) => void | Promise<void>;
  onDeleteExistingRooms?: (rooms: MeetingRoom[]) => void | Promise<void>;
  onJoinRoom: (code: string) => void | Promise<void>;
  onOpenAuth: (mode: AuthMode) => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
  isOpeningRoom?: boolean;
  roomError?: string | null;
}

const categoryLabels: Record<MeetCategoryKey, string> = {
  dining: '식사',
  cafe: '카페',
  drink: '술자리',
  date: '데이트',
  culture: '문화',
  activity: '액티비티',
};

function formatRoomUpdatedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '최근 사용';
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) {
    return '방금 전';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }

  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function KoKBrandMark() {
  return (
    <div className="kok-brand-float kok-brand-glow mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-[1.75rem] bg-[#16241D] shadow-[0_24px_60px_rgba(20,35,29,0.18)]">
      <svg
        viewBox="0 0 160 160"
        className="h-24 w-24"
        aria-hidden="true"
      >
        <path
          d="M40 43c16 4 28 14 39 32"
          fill="none"
          stroke="#0CA178"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M120 43c-16 4-28 14-39 32"
          fill="none"
          stroke="#8d7cff"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M39 112c18-5 31-17 43-37"
          fill="none"
          stroke="#ffd166"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <circle cx="36" cy="42" r="13" fill="#f8fbf7" stroke="#0CA178" strokeWidth="4" />
        <circle cx="124" cy="42" r="13" fill="#f8fbf7" stroke="#8d7cff" strokeWidth="4" />
        <circle cx="34" cy="116" r="13" fill="#f8fbf7" stroke="#ffd166" strokeWidth="4" />
        <circle cx="80" cy="80" r="42" fill="#f8fbf7" />
        <path
          d="M80 43c-21 0-36 16-36 36 0 26 36 54 36 54s36-28 36-54c0-20-15-36-36-36Z"
          fill="#12B886"
        />
        <circle cx="80" cy="77" r="14" fill="#16241D" />
        <path
          d="M64 59c6-8 15-13 26-12 10 0 18 5 24 12-7-4-15-6-24-6-11 0-20 2-26 6Z"
          fill="#A8EAD6"
          opacity=".9"
        />
      </svg>
    </div>
  );
}

export function HomeScreen({
  currentUser,
  onCreateRoom,
  createdRooms = [],
  isLoadingCreatedRooms = false,
  createdRoomsError = null,
  deletingRoomIds = [],
  onRefreshRooms,
  onOpenExistingRoom,
  onDeleteExistingRooms,
  onJoinRoom,
  onOpenAuth,
  onOpenProfile,
  onSignOut,
  isOpeningRoom = false,
  roomError = null,
}: HomeScreenProps) {
  const [roomCode, setRoomCode] = useState('');
  const [showCreatedRooms, setShowCreatedRooms] = useState(false);
  const [isEditingRooms, setIsEditingRooms] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const selectedRooms = createdRooms.filter((room) => selectedRoomIds.includes(room.id));
  const isDeletingRooms = deletingRoomIds.length > 0;
  const allRoomsSelected = createdRooms.length > 0 && selectedRoomIds.length === createdRooms.length;

  useEffect(() => {
    setSelectedRoomIds((current) =>
      current.filter((roomId) => createdRooms.some((room) => room.id === roomId)),
    );
  }, [createdRooms]);

  const toggleRoomSelection = (roomId: string) => {
    setSelectedRoomIds((current) =>
      current.includes(roomId)
        ? current.filter((selectedRoomId) => selectedRoomId !== roomId)
        : [...current, roomId],
    );
  };

  const toggleAllRooms = () => {
    setSelectedRoomIds(allRoomsSelected ? [] : createdRooms.map((room) => room.id));
  };

  return (
    <div className="kok-screen-enter relative flex min-h-screen flex-col overflow-hidden bg-[#FAFCFB] pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <div className="kok-home-ambient pointer-events-none absolute inset-0" />
      <svg
        viewBox="0 0 420 420"
        className="kok-route-lines pointer-events-none absolute left-1/2 top-10 h-[420px] w-[420px] -translate-x-1/2 text-[#16241D]/10"
        aria-hidden="true"
      >
        <path
          d="M54 178c74-56 129-60 202-8 57 41 91 45 128 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="7 13"
          strokeLinecap="round"
        />
        <path
          d="M80 276c70-37 116-32 167 19 37 37 81 48 130 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="7 13"
          strokeLinecap="round"
        />
      </svg>

      {currentUser && (
        <header className="fixed left-0 top-0 z-30 flex w-full items-center justify-end rounded-b-[1.75rem] border-b border-white/70 bg-[#FAFCFB]/88 px-6 py-4 shadow-[0_10px_30px_rgba(20,35,29,0.08)] backdrop-blur-md">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenProfile}
              className="inline-flex h-10 max-w-[116px] items-center gap-2 rounded-full bg-white px-3 text-sm text-[#16241D] shadow-sm transition-transform active:scale-95"
            >
              {currentUser.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded-full object-cover"
                />
              ) : (
                <UserRound className="h-4 w-4 shrink-0 text-[#6E7C75]" />
              )}
              <span className="truncate">{currentUser.name}</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#6E7C75] shadow-sm"
              aria-label="로그아웃"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
      )}

      <main
        className={`relative z-10 mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 ${
          currentUser ? 'pt-28' : 'pt-20'
        }`}
      >
        <div className="kok-hero-copy mb-9 text-center">
          <KoKBrandMark />
          <div className="mx-auto mb-4 inline-flex h-9 items-center gap-2 rounded-full border border-[#E4EFE9] bg-white/78 px-3 text-xs font-black text-[#0CA178] shadow-[0_10px_24px_rgba(20,35,29,0.05)] backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-[#12B886]" />
            온라인 약속방
          </div>
          <h1 className="text-5xl font-black tracking-normal text-[#16241D]">KoK</h1>
          <p className="mt-4 text-2xl font-bold leading-tight tracking-normal text-[#667280]">
            어디서 볼지, 같이 가볍게 정해요.
          </p>
        </div>

        <section className="kok-stagger-list space-y-4">
          {currentUser ? (
            <>
              <div className="kok-card-pop rounded-[1.5rem] border border-white/70 bg-white/92 px-5 py-4 text-left shadow-[0_10px_30px_rgba(20,35,29,0.06)] backdrop-blur-md">
                <div className="text-sm font-semibold text-[#12B886]">온라인 약속방</div>
                <div className="mt-1 truncate text-xl font-extrabold tracking-normal text-[#16241D]">
                  {currentUser.name}님, 바로 시작할까요?
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void onCreateRoom();
                  }}
                  disabled={isOpeningRoom || isDeletingRooms}
                  className="kok-pressable kok-button-shine flex h-16 items-center justify-center gap-2 rounded-[1.5rem] bg-[#16241D] px-4 text-lg font-extrabold tracking-normal text-white shadow-[0_12px_32px_rgba(20,35,29,0.16)] transition-transform active:scale-95 disabled:opacity-60"
                >
                  {isOpeningRoom ? (
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  ) : (
                    <Plus className="h-6 w-6" />
                  )}
                  새로 만들기
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const nextShowState = !showCreatedRooms;
                    setShowCreatedRooms(nextShowState);

                    if (nextShowState) {
                      void onRefreshRooms?.();
                    } else {
                      setIsEditingRooms(false);
                      setSelectedRoomIds([]);
                    }
                  }}
                  disabled={isOpeningRoom || isDeletingRooms}
                  aria-pressed={showCreatedRooms}
                  className={`kok-pressable flex h-16 items-center justify-center gap-2 rounded-[1.5rem] px-4 text-lg font-extrabold tracking-normal shadow-[0_10px_30px_rgba(20,35,29,0.06)] transition-transform active:scale-95 disabled:opacity-60 ${
                    showCreatedRooms
                      ? 'bg-[#12B886] text-white'
                      : 'border border-white/70 bg-white/92 text-[#16241D]'
                  }`}
                >
                  <Clock3 className="h-5 w-5" />
                  이어하기
                </button>
              </div>

              <div className="relative rounded-[1.5rem] border border-[#EEF3F0]/70 bg-white/94 p-2 shadow-[0_10px_30px_rgba(20,35,29,0.04)] backdrop-blur-md">
                <input
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void onJoinRoom(roomCode);
                    }
                  }}
                  placeholder="초대받은 방 코드"
                  className="h-14 w-full rounded-[1.15rem] border-0 bg-transparent pl-5 pr-16 text-lg text-[#16241D] outline-none placeholder:text-[#a3a6ad] focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => {
                    void onJoinRoom(roomCode);
                  }}
                  disabled={isOpeningRoom}
                  className="absolute bottom-2 right-2 top-2 flex w-14 items-center justify-center rounded-[1.1rem] bg-[#E6F7F0] text-[#0CA178] shadow-sm transition-transform active:scale-95 disabled:opacity-60"
                  aria-label="방 코드 입장"
                >
                  <ArrowRight className="h-6 w-6" />
                </button>
              </div>

              {showCreatedRooms ? (
                <div className="kok-card-pop rounded-[1.5rem] border border-white/70 bg-white/92 p-4 text-left shadow-[0_10px_30px_rgba(20,35,29,0.05)] backdrop-blur-md">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-[#16241D]">이어하기</div>
                      <div className="mt-0.5 text-xs text-[#9AA8A1]">
                        참여했던 방을 다시 열 수 있어요.
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {createdRooms.length ? (
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditingRooms((current) => !current);
                            setSelectedRoomIds([]);
                          }}
                          disabled={isDeletingRooms}
                          className="rounded-full bg-[#eef7f3] px-3 py-2 text-xs font-bold text-[#16241D] shadow-sm transition-transform active:scale-95 disabled:opacity-50"
                        >
                          {isEditingRooms ? '완료' : '편집'}
                        </button>
                      ) : null}

                      {onRefreshRooms ? (
                        <button
                          type="button"
                          onClick={() => {
                            void onRefreshRooms();
                          }}
                          disabled={isLoadingCreatedRooms || isDeletingRooms}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eef7f3] text-[#16241D] shadow-sm transition-transform active:scale-95 disabled:opacity-50"
                          aria-label="기존 방 새로고침"
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${isLoadingCreatedRooms ? 'animate-spin' : ''}`}
                          />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {isEditingRooms && createdRooms.length ? (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-[#F5F9F7] px-3 py-2">
                      <button
                        type="button"
                        onClick={toggleAllRooms}
                        disabled={isDeletingRooms}
                        className="text-xs font-bold text-[#16241D] disabled:opacity-50"
                      >
                        {allRoomsSelected ? '전체 해제' : '전체 선택'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onDeleteExistingRooms?.(selectedRooms);
                        }}
                        disabled={!selectedRooms.length || isDeletingRooms}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#E6F7F0] px-3 text-xs font-bold text-[#0CA178] shadow-sm transition-transform active:scale-95 disabled:opacity-40"
                      >
                        {isDeletingRooms ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        선택 정리 {selectedRooms.length ? selectedRooms.length : ''}
                      </button>
                    </div>
                  ) : null}

                  {isLoadingCreatedRooms && !createdRooms.length ? (
                    <div className="kok-loading-card flex items-center gap-3 rounded-2xl bg-[#F5F9F7] px-3 py-3 text-sm text-[#6E7C75]">
                      <div className="kok-route-loader scale-75">
                        <span />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[#16241D]">방 목록 정리 중</div>
                        <div className="mt-1 kok-loading-progress" />
                      </div>
                    </div>
                  ) : createdRooms.length ? (
                    <div className="space-y-2">
                      {createdRooms.map((room) => {
                        const members = room.members ?? [];
                        const memberCount = room.memberCount ?? members.length;
                        const visibleMembers = members.slice(0, 3);
                        const hiddenMemberCount = Math.max(0, memberCount - visibleMembers.length);
                        const isSelected = selectedRoomIds.includes(room.id);
                        const isDeletingRoom = deletingRoomIds.includes(room.id);

                        return (
                          <button
                            key={room.id}
                            type="button"
                            onClick={() => {
                              if (isEditingRooms) {
                                toggleRoomSelection(room.id);
                                return;
                              }

                              void onOpenExistingRoom?.(room);
                            }}
                            disabled={isOpeningRoom || isDeletingRoom}
                            className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-transform active:scale-[0.99] disabled:opacity-60 ${
                              isSelected ? 'bg-[#E6F7F0] ring-2 ring-[#12B886]' : 'bg-[#fbfdfb]'
                            }`}
                          >
                            {isEditingRooms ? (
                              <span
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                                  isSelected
                                    ? 'border-[#12B886] bg-[#12B886] text-white'
                                    : 'border-[#E4EFE9] bg-white text-transparent'
                                }`}
                              >
                                <Check className="h-4 w-4" />
                              </span>
                            ) : null}

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-black tracking-normal text-[#16241D]">
                                  {room.code}
                                </span>
                                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#6E7C75]">
                                  {room.status === 'decided' ? '결과 있음' : '진행 중'}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center gap-1.5 text-xs text-[#9AA8A1]">
                                <Clock3 className="h-3.5 w-3.5" />
                                {formatRoomUpdatedAt(room.updatedAt)}
                                <span>·</span>
                                {categoryLabels[room.selectedCategory]}
                              </div>
                              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-bold text-[#6E7C75]">
                                  <UsersRound className="h-3.5 w-3.5" />
                                  {memberCount ? `${memberCount}명` : '멤버 없음'}
                                </span>
                                {visibleMembers.map((member) => (
                                  <span
                                    key={member.id}
                                    className="max-w-[92px] truncate rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#16241D]"
                                  >
                                    {member.name}
                                  </span>
                                ))}
                                {hiddenMemberCount > 0 ? (
                                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#9AA8A1]">
                                    +{hiddenMemberCount}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            {isDeletingRoom ? (
                              <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-[#9AA8A1]" />
                            ) : isEditingRooms ? null : (
                              <ArrowRight className="h-5 w-5 shrink-0 text-[#16241D]" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-[#F5F9F7] px-3 py-3 text-sm text-[#9AA8A1]">
                      아직 이어갈 방이 없어요.
                    </div>
                  )}

                  {createdRoomsError ? (
                    <div className="mt-2 rounded-2xl bg-[#E6F7F0] px-3 py-2 text-xs text-[#0CA178]">
                      {createdRoomsError}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onOpenAuth('signup')}
                className="kok-pressable kok-button-shine flex h-[72px] w-full items-center justify-center gap-4 rounded-[1.5rem] bg-[#16241D] px-5 text-xl font-extrabold tracking-normal text-white shadow-[0_14px_34px_rgba(20,35,29,0.16)] transition-transform active:scale-95"
              >
                <UserPlus className="h-7 w-7" />
                회원가입하고 시작
              </button>

              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="kok-pressable flex h-14 w-full items-center justify-center gap-2 rounded-[1.35rem] border border-[#E4EFE9] bg-white/88 px-5 text-base font-semibold text-[#16241D] shadow-[0_10px_30px_rgba(20,35,29,0.04)] backdrop-blur-md transition-transform active:scale-95"
              >
                <UserRound className="h-5 w-5 text-[#6E7C75]" />
                로그인
              </button>
            </>
          )}

          {roomError && (
            <div className="rounded-[1.25rem] border border-[#CFEBDF] bg-[#E6F7F0] px-4 py-3 text-sm text-[#0CA178]">
              {roomError}
            </div>
          )}
        </section>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-semibold text-[#9AA8A1]">
          <a
            href="/landing"
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors hover:bg-white/60 hover:text-[#16241D]"
          >
            KoK 소개
            <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href="/privacy.html"
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors hover:bg-white/60 hover:text-[#16241D]"
          >
            개인정보처리방침
            <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href="/support.html"
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors hover:bg-white/60 hover:text-[#16241D]"
          >
            지원
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </main>

    </div>
  );
}
