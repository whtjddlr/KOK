import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Clock3,
  LoaderCircle,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Trash2,
  User,
  UserPlus,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { AuthUser } from '../lib/auth';
import { AuthMode } from './AuthSheet';
import { MeetingRoom, MeetCategoryKey } from '../types';

interface HomeScreenProps {
  currentUser: AuthUser | null;
  onContinueAsGuest: () => void;
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

export function HomeScreen({
  currentUser,
  onContinueAsGuest,
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
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f5f1eb] pb-28">
      <div className="pointer-events-none absolute left-1/2 top-28 h-96 w-96 -translate-x-1/2 rounded-full bg-[#ff7b6b]/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-20 h-80 w-80 rounded-full bg-[#5dd9d0]/12 blur-3xl" />

      {currentUser && (
        <header className="fixed left-0 top-0 z-30 flex w-full items-center justify-end rounded-b-[2rem] bg-[#f5f1eb]/88 px-6 py-4 shadow-[0_10px_30px_rgba(26,26,46,0.08)] backdrop-blur-md">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenProfile}
              className="inline-flex h-10 max-w-[116px] items-center gap-2 rounded-full bg-white px-3 text-sm text-[#1f2a44] shadow-sm transition-transform active:scale-95"
            >
              {currentUser.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded-full object-cover"
                />
              ) : (
                <UserRound className="h-4 w-4 shrink-0 text-[#76777e]" />
              )}
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
        </header>
      )}

      <main
        className={`relative z-10 mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 ${
          currentUser ? 'pt-28' : 'pt-12'
        }`}
      >
        <div className="mb-9 text-center">
          <div className="mx-auto mb-7 flex h-28 w-28 items-center justify-center rounded-full border-4 border-white bg-[#ffc9c1] text-[#7a130f] shadow-[0_20px_55px_rgba(26,26,46,0.12)]">
            <MapPin className="h-14 w-14 fill-current" />
          </div>
          <h1 className="text-5xl font-black tracking-[-0.08em] text-[#1f2a44]">KoK</h1>
          <p className="mt-4 text-2xl font-bold leading-tight tracking-[-0.06em] text-[#76777e]">
            어디서 볼지, 같이 가볍게 정해요.
          </p>
        </div>

        <section className="space-y-5">
          {currentUser ? (
            <>
              <div className="rounded-[1.5rem] border border-white/70 bg-white/92 px-5 py-4 text-left shadow-[0_10px_30px_rgba(26,26,46,0.06)]">
                <div className="text-sm font-semibold text-[#ff7b6b]">온라인 약속방</div>
                <div className="mt-1 truncate text-xl font-extrabold tracking-[-0.05em] text-[#1f2a44]">
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
                  className="flex h-16 items-center justify-center gap-2 rounded-[1.5rem] bg-[#1f2a44] px-4 text-lg font-extrabold tracking-[-0.04em] text-white shadow-[0_12px_32px_rgba(26,26,46,0.14)] transition-transform active:scale-95 disabled:opacity-60"
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
                  className={`flex h-16 items-center justify-center gap-2 rounded-[1.5rem] px-4 text-lg font-extrabold tracking-[-0.04em] shadow-[0_10px_30px_rgba(26,26,46,0.06)] transition-transform active:scale-95 disabled:opacity-60 ${
                    showCreatedRooms
                      ? 'bg-[#ff7b6b] text-white'
                      : 'border border-white/70 bg-white/92 text-[#1f2a44]'
                  }`}
                >
                  <Clock3 className="h-5 w-5" />
                  이어하기
                </button>
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
                  placeholder="초대받은 방 코드"
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

              {showCreatedRooms ? (
                <div className="rounded-[1.5rem] border border-white/70 bg-white/92 p-4 text-left shadow-[0_10px_30px_rgba(26,26,46,0.05)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-[#1f2a44]">이어하기</div>
                      <div className="mt-0.5 text-xs text-[#8a94a2]">
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
                          className="rounded-full bg-[#f5f1eb] px-3 py-2 text-xs font-bold text-[#1f2a44] shadow-sm transition-transform active:scale-95 disabled:opacity-50"
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
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f5f1eb] text-[#1f2a44] shadow-sm transition-transform active:scale-95 disabled:opacity-50"
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
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-[#f8fbfd] px-3 py-2">
                      <button
                        type="button"
                        onClick={toggleAllRooms}
                        disabled={isDeletingRooms}
                        className="text-xs font-bold text-[#1f2a44] disabled:opacity-50"
                      >
                        {allRoomsSelected ? '전체 해제' : '전체 선택'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onDeleteExistingRooms?.(selectedRooms);
                        }}
                        disabled={!selectedRooms.length || isDeletingRooms}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#fff7ed] px-3 text-xs font-bold text-[#b45309] shadow-sm transition-transform active:scale-95 disabled:opacity-40"
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
                    <div className="flex items-center gap-2 rounded-2xl bg-[#f8fbfd] px-3 py-3 text-sm text-[#6b7280]">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      방 목록 불러오는 중
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
                              isSelected ? 'bg-[#fff0ed] ring-2 ring-[#ff7b6b]' : 'bg-[#fbf8fb]'
                            }`}
                          >
                            {isEditingRooms ? (
                              <span
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                                  isSelected
                                    ? 'border-[#ff7b6b] bg-[#ff7b6b] text-white'
                                    : 'border-[#d9dde4] bg-white text-transparent'
                                }`}
                              >
                                <Check className="h-4 w-4" />
                              </span>
                            ) : null}

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-black tracking-[0.08em] text-[#1f2a44]">
                                  {room.code}
                                </span>
                                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#76777e]">
                                  {room.status === 'decided' ? '결과 있음' : '진행 중'}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center gap-1.5 text-xs text-[#8a94a2]">
                                <Clock3 className="h-3.5 w-3.5" />
                                {formatRoomUpdatedAt(room.updatedAt)}
                                <span>·</span>
                                {categoryLabels[room.selectedCategory]}
                              </div>
                              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-bold text-[#76777e]">
                                  <UsersRound className="h-3.5 w-3.5" />
                                  {memberCount ? `${memberCount}명` : '멤버 없음'}
                                </span>
                                {visibleMembers.map((member) => (
                                  <span
                                    key={member.id}
                                    className="max-w-[92px] truncate rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#1f2a44]"
                                  >
                                    {member.name}
                                  </span>
                                ))}
                                {hiddenMemberCount > 0 ? (
                                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#8a94a2]">
                                    +{hiddenMemberCount}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            {isDeletingRoom ? (
                              <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-[#8a94a2]" />
                            ) : isEditingRooms ? null : (
                              <ArrowRight className="h-5 w-5 shrink-0 text-[#1f2a44]" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-[#f8fbfd] px-3 py-3 text-sm text-[#8a94a2]">
                      아직 이어갈 방이 없어요.
                    </div>
                  )}

                  {createdRoomsError ? (
                    <div className="mt-2 rounded-2xl bg-[#fff7ed] px-3 py-2 text-xs text-[#b45309]">
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
                className="flex h-[72px] w-full items-center justify-center gap-4 rounded-[1.5rem] bg-[#1f2a44] px-5 text-xl font-extrabold tracking-[-0.04em] text-white shadow-[0_10px_30px_rgba(26,26,46,0.08)] transition-transform active:scale-95"
              >
                <UserPlus className="h-7 w-7" />
                회원가입하고 시작
              </button>

              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-[1.35rem] border border-[#dfe5eb] bg-white px-5 text-base font-semibold text-[#1f2a44] shadow-[0_10px_30px_rgba(26,26,46,0.04)] transition-transform active:scale-95"
              >
                <UserRound className="h-5 w-5 text-[#76777e]" />
                로그인
              </button>
            </>
          )}

          {roomError && (
            <div className="rounded-[1.25rem] border border-[#ffdad6] bg-[#fff5f2] px-4 py-3 text-sm text-[#a6392e]">
              {roomError}
            </div>
          )}
        </section>

        {!currentUser && (
          <div className="mt-7 flex items-center justify-center text-sm text-[#76777e]">
            <button
              type="button"
              onClick={onContinueAsGuest}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 transition-colors hover:bg-white/60"
            >
              <User className="h-4 w-4" />
              게스트로 혼자 써보기
            </button>
          </div>
        )}
      </main>

    </div>
  );
}
