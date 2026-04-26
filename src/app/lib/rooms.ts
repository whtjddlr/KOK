import { Candidate, MeetCategoryKey, MeetingRoom, Participant, RoomMemberSummary } from '../types';
import { normalizeParticipantGender } from './gender';
import { getSafeLocationLabel } from './service-area';
import {
  getSupabaseBrowserClient,
  getSupabasePublicClient,
  isSupabaseConfigured,
} from './supabase';

interface MeetingRoomRow {
  id: string;
  code: string;
  owner_id: string | null;
  draw_controller_id?: string | null;
  draw_ready_ids?: unknown;
  redraw_votes?: unknown;
  redraw_requested_at?: string | null;
  selected_category: string | null;
  selected_candidate: Candidate | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

interface RoomParticipantRow {
  id: string;
  room_id: string;
  created_by: string | null;
  name: string;
  avatar_url?: string | null;
  location: string;
  latitude: number;
  longitude: number;
  max_travel_time: number | null;
  location_source: string | null;
  travel_mode?: string | null;
  gender?: string | null;
  saved_friend_id: string | null;
}

interface RoomMemberSummaryRow {
  id: string;
  room_id: string;
  created_by: string | null;
  name: string;
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_ROOM_SELECT =
  'id, code, owner_id, selected_category, selected_candidate, status, created_at, updated_at';
const CONTROL_ROOM_SELECT = `${BASE_ROOM_SELECT}, draw_controller_id, draw_ready_ids, redraw_votes, redraw_requested_at`;
const BASE_PARTICIPANT_SELECT =
  'id, room_id, created_by, name, location, latitude, longitude, max_travel_time, location_source, saved_friend_id';
const PARTICIPANT_TRAVEL_MODE_SELECT = 'travel_mode';
const PARTICIPANT_GENDER_SELECT = 'gender';
const PARTICIPANT_AVATAR_SELECT = 'avatar_url';
const LOCAL_PARTICIPANTS_KEY_PREFIX = 'randommeet.room.participants.';
const READY_VOTE_SCHEMA_HINT =
  '레디/투표 DB 준비가 아직 안 됐어요. Supabase SQL Editor에서 supabase/ready-vote-sync.sql을 실행해 주세요.';

let canUseRoomControlColumns: boolean | null = null;
let canUseParticipantTravelModeColumn: boolean | null = null;
let canUseParticipantGenderColumn: boolean | null = null;
let canUseParticipantAvatarColumn: boolean | null = null;

function normalizeNullableUuid(value?: string | null) {
  const trimmed = value?.trim();

  return trimmed && UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function getClientOrThrow() {
  const supabase = getSupabasePublicClient();

  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Supabase 연결이 필요합니다.');
  }

  return supabase;
}

function getAuthenticatedClientOrPublic() {
  return getSupabaseBrowserClient() ?? getClientOrThrow();
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getLocalParticipantStorageKey(roomId: string) {
  return `${LOCAL_PARTICIPANTS_KEY_PREFIX}${roomId}`;
}

function isMissingRoomControlColumnError(error: unknown) {
  const message =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';

  return (
    message.includes('draw_controller_id') ||
    message.includes('draw_ready_ids') ||
    message.includes('redraw_votes') ||
    message.includes('redraw_requested_at')
  );
}

function isMissingParticipantTravelModeColumnError(error: unknown) {
  const message =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';

  return message.includes('travel_mode');
}

function isMissingParticipantGenderColumnError(error: unknown) {
  const message =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';

  return message.includes('gender');
}

function isMissingParticipantAvatarColumnError(error: unknown) {
  const message =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';

  return message.includes('avatar_url');
}

function disableMissingParticipantOptionalColumn(error: unknown) {
  let shouldRetry = false;

  if (
    canUseParticipantTravelModeColumn !== false &&
    isMissingParticipantTravelModeColumnError(error)
  ) {
    canUseParticipantTravelModeColumn = false;
    shouldRetry = true;
  }

  if (
    canUseParticipantGenderColumn !== false &&
    isMissingParticipantGenderColumnError(error)
  ) {
    canUseParticipantGenderColumn = false;
    shouldRetry = true;
  }

  if (
    canUseParticipantAvatarColumn !== false &&
    isMissingParticipantAvatarColumnError(error)
  ) {
    canUseParticipantAvatarColumn = false;
    shouldRetry = true;
  }

  return shouldRetry;
}

function getRoomSelectColumns() {
  return canUseRoomControlColumns === false ? BASE_ROOM_SELECT : CONTROL_ROOM_SELECT;
}

function getParticipantSelectColumns() {
  const optionalColumns = [
    canUseParticipantTravelModeColumn === false ? null : PARTICIPANT_TRAVEL_MODE_SELECT,
    canUseParticipantGenderColumn === false ? null : PARTICIPANT_GENDER_SELECT,
    canUseParticipantAvatarColumn === false ? null : PARTICIPANT_AVATAR_SELECT,
  ].filter(Boolean);

  return [BASE_PARTICIPANT_SELECT, ...optionalColumns].join(', ');
}

function normalizeRedrawVotes(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function createRoomCode() {
  const values = new Uint32Array(ROOM_CODE_LENGTH);

  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(values);
  } else {
    values.forEach((_, index) => {
      values[index] = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    });
  }

  return Array.from(values)
    .map((value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length])
    .join('');
}

function normalizeCategory(category: string | null | undefined): MeetCategoryKey {
  const knownCategories: MeetCategoryKey[] = [
    'dining',
    'cafe',
    'drink',
    'date',
    'culture',
    'activity',
  ];

  return knownCategories.includes(category as MeetCategoryKey)
    ? (category as MeetCategoryKey)
    : 'dining';
}

function mapRoom(row: MeetingRoomRow): MeetingRoom {
  return {
    id: row.id,
    code: row.code,
    ownerId: row.owner_id,
    drawControllerId: row.draw_controller_id ?? null,
    drawReadyIds: normalizeStringList(row.draw_ready_ids),
    redrawVotes: normalizeRedrawVotes(row.redraw_votes),
    redrawRequestedAt: row.redraw_requested_at ?? null,
    selectedCategory: normalizeCategory(row.selected_category),
    selectedCandidate: row.selected_candidate ?? null,
    status: row.status === 'decided' ? 'decided' : 'planning',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapParticipant(row: RoomParticipantRow): Participant {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url ?? null,
    location: getSafeLocationLabel(row.location),
    coordinates: {
      lat: Number(row.latitude),
      lng: Number(row.longitude),
    },
    maxTravelTime: Number(row.max_travel_time) || 45,
    travelMode: row.travel_mode === 'car' ? 'car' : 'transit',
    gender: normalizeParticipantGender(row.gender),
    locationSource:
      row.location_source === 'current' ||
      row.location_source === 'address' ||
      row.location_source === 'map' ||
      row.location_source === 'station'
        ? row.location_source
        : undefined,
    savedFriendId: row.saved_friend_id ?? undefined,
    createdBy: row.created_by,
  };
}

function mapRoomMember(row: RoomMemberSummaryRow): RoomMemberSummary {
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    createdBy: row.created_by,
  };
}

async function attachRoomMembers(rooms: MeetingRoom[]) {
  if (!rooms.length) {
    return rooms;
  }

  const supabase = getClientOrThrow();
  const roomIds = rooms.map((room) => room.id);
  const { data, error } = await supabase
    .from('meeting_room_participants')
    .select('id, room_id, created_by, name')
    .in('room_id', roomIds)
    .order('created_at', { ascending: true });

  if (error) {
    return rooms.map((room) => ({
      ...room,
      members: [] as RoomMemberSummary[],
      memberCount: 0,
    }));
  }

  const membersByRoom = new Map<string, RoomMemberSummary[]>();

  (data as RoomMemberSummaryRow[] | null)?.forEach((row) => {
    const member = mapRoomMember(row);
    const current = membersByRoom.get(member.roomId) ?? [];
    current.push(member);
    membersByRoom.set(member.roomId, current);
  });

  return rooms.map((room) => {
    const members = membersByRoom.get(room.id) ?? [];

    return {
      ...room,
      members,
      memberCount: members.length,
    };
  });
}

export function isOnlineRoomsAvailable() {
  return isSupabaseConfigured();
}

export function rememberLocalRoomParticipant(roomId: string, participantId: string) {
  if (!canUseStorage() || !roomId || !participantId) {
    return;
  }

  const current = getLocalRoomParticipantIds(roomId);
  const next = current.includes(participantId) ? current : [...current, participantId];
  window.localStorage.setItem(getLocalParticipantStorageKey(roomId), JSON.stringify(next));
}

export function forgetLocalRoomParticipant(roomId: string, participantId: string) {
  if (!canUseStorage() || !roomId || !participantId) {
    return;
  }

  const next = getLocalRoomParticipantIds(roomId).filter((id) => id !== participantId);
  window.localStorage.setItem(getLocalParticipantStorageKey(roomId), JSON.stringify(next));
}

export function getLocalRoomParticipantIds(roomId: string) {
  if (!canUseStorage() || !roomId) {
    return [] as string[];
  }

  try {
    const raw = window.localStorage.getItem(getLocalParticipantStorageKey(roomId));
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
  } catch {
    return [] as string[];
  }
}

export function getParticipantActorKey(participant: Participant) {
  return participant.createdBy || participant.id;
}

export function getPreferredDrawControllerId(
  participants: Participant[],
  ownerId?: string | null,
) {
  if (!participants.length) {
    return null;
  }

  if (ownerId) {
    const ownerParticipant = participants.find((participant) => participant.createdBy === ownerId);

    if (ownerParticipant) {
      return ownerId;
    }
  }

  return getParticipantActorKey(participants[0]);
}

export function getCurrentRoomActorIds(input: {
  roomId?: string | null;
  currentUserId?: string | null;
  participants: Participant[];
}) {
  const actorIds = new Set<string>();

  if (
    input.currentUserId &&
    input.participants.some((participant) => participant.createdBy === input.currentUserId)
  ) {
    actorIds.add(input.currentUserId);
  }

  if (input.roomId) {
    const participantIds = new Set(input.participants.map((participant) => participant.id));
    getLocalRoomParticipantIds(input.roomId)
      .filter((participantId) => participantIds.has(participantId))
      .forEach((participantId) => actorIds.add(participantId));
  }

  return [...actorIds];
}

export function getRedrawRequiredVotes(participantCount: number) {
  return Math.max(1, Math.floor(participantCount / 2) + 1);
}

export function getRoomShareUrl(code: string) {
  const publicOrigin = import.meta.env.VITE_PUBLIC_APP_URL?.trim() || 'https://kok-meet.vercel.app';

  if (typeof window === 'undefined') {
    return `${publicOrigin}?room=${encodeURIComponent(code)}`;
  }

  const isLocalPreview =
    window.location.protocol === 'file:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  const url = new URL(isLocalPreview ? publicOrigin : window.location.href);
  url.searchParams.set('room', code);
  return url.toString();
}

export async function createMeetingRoom(input: {
  ownerId?: string | null;
  selectedCategory: MeetCategoryKey;
}) {
  const supabase = getClientOrThrow();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = createRoomCode();
    const { data, error } = await supabase
      .from('meeting_rooms')
      .insert({
        code,
        owner_id: normalizeNullableUuid(input.ownerId),
        selected_category: input.selectedCategory,
      })
      .select(BASE_ROOM_SELECT)
      .single();

    if (!error && data) {
      return mapRoom(data as MeetingRoomRow);
    }

    lastError = error;
  }

  throw lastError ?? new Error('약속방을 만들지 못했습니다.');
}

export async function loadMeetingRoomByCode(code: string) {
  const supabase = getClientOrThrow();
  const normalizedCode = code.trim().toUpperCase();

  const loadRoom = (columns: string) =>
    supabase
      .from('meeting_rooms')
      .select(columns)
      .eq('code', normalizedCode)
      .maybeSingle();

  let { data, error } = await loadRoom(getRoomSelectColumns());

  if (error && canUseRoomControlColumns !== false && isMissingRoomControlColumnError(error)) {
    canUseRoomControlColumns = false;
    ({ data, error } = await loadRoom(BASE_ROOM_SELECT));
  } else if (!error && canUseRoomControlColumns !== false) {
    canUseRoomControlColumns = true;
  }

  if (error) {
    throw error;
  }

  return data ? mapRoom(data as MeetingRoomRow) : null;
}

export async function loadOwnedMeetingRooms(ownerId: string, limit = 8) {
  const supabase = getClientOrThrow();
  const normalizedOwnerId = normalizeNullableUuid(ownerId);

  if (!normalizedOwnerId) {
    return [] as MeetingRoom[];
  }

  const { data, error } = await supabase
    .from('meeting_rooms')
    .select(getRoomSelectColumns())
    .eq('owner_id', normalizedOwnerId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingRoomControlColumnError(error)) {
      canUseRoomControlColumns = false;
      return loadOwnedMeetingRooms(ownerId, limit);
    }

    throw error;
  }

  const ownedRooms = (data ?? []).map((row) => mapRoom(row as MeetingRoomRow));
  const { data: participantRows } = await supabase
    .from('meeting_room_participants')
    .select('room_id')
    .eq('created_by', normalizedOwnerId)
    .limit(limit);
  const participantRoomIds = [
    ...new Set(
      (participantRows as Array<{ room_id?: string }> | null)
        ?.map((row) => row.room_id)
        .filter((roomId): roomId is string => Boolean(roomId)) ?? [],
    ),
  ].filter((roomId) => !ownedRooms.some((room) => room.id === roomId));
  let joinedRooms: MeetingRoom[] = [];

  if (participantRoomIds.length) {
    const { data: joinedData, error: joinedError } = await supabase
      .from('meeting_rooms')
      .select(getRoomSelectColumns())
      .in('id', participantRoomIds);

    if (!joinedError) {
      joinedRooms = (joinedData ?? []).map((row) => mapRoom(row as MeetingRoomRow));
    }
  }

  const mergedRooms = [...ownedRooms, ...joinedRooms]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);

  return attachRoomMembers(mergedRooms);
}

export async function deleteOwnedMeetingRoom(input: {
  roomId: string;
  ownerId: string;
}) {
  await deleteOwnedMeetingRooms({
    roomIds: [input.roomId],
    ownerId: input.ownerId,
  });
}

export async function deleteOwnedMeetingRooms(input: {
  roomIds: string[];
  ownerId: string;
}) {
  const supabase = getClientOrThrow();
  const deleteClient = getAuthenticatedClientOrPublic();
  const normalizedOwnerId = normalizeNullableUuid(input.ownerId);
  const roomIds = [...new Set(input.roomIds.filter((roomId) => roomId.trim().length > 0))];

  if (!normalizedOwnerId) {
    throw new Error('삭제할 수 있는 로그인 정보가 없어요.');
  }

  if (!roomIds.length) {
    return [] as Array<{ roomId: string; action: 'left' | 'deleted' }>;
  }

  const results: Array<{ roomId: string; action: 'left' | 'deleted' }> = [];

  for (const roomId of roomIds) {
    const { data: participants, error: participantsError } = await supabase
      .from('meeting_room_participants')
      .select('id, room_id, created_by, name')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (participantsError) {
      throw participantsError;
    }

    const participantRows = (participants ?? []) as RoomMemberSummaryRow[];
    const leavingParticipantIds = participantRows
      .filter((participant) => participant.created_by === normalizedOwnerId)
      .map((participant) => participant.id);

    if (leavingParticipantIds.length) {
      const { error: leaveError } = await supabase
        .from('meeting_room_participants')
        .delete()
        .eq('room_id', roomId)
        .in('id', leavingParticipantIds);

      if (leaveError) {
        throw leaveError;
      }
    }

    const remainingParticipants = participantRows.filter(
      (participant) => !leavingParticipantIds.includes(participant.id),
    );

    if (remainingParticipants.length) {
      const nextOwnerId =
        remainingParticipants.find((participant) => participant.created_by)?.created_by ?? null;
      const roomControlCleanup =
        canUseRoomControlColumns === false
          ? {}
          : {
              owner_id: nextOwnerId,
              draw_controller_id: null,
              updated_at: new Date().toISOString(),
            };
      const fallbackCleanup =
        canUseRoomControlColumns === false
          ? {
              owner_id: nextOwnerId,
              updated_at: new Date().toISOString(),
            }
          : {};
      const primaryCleanup =
        canUseRoomControlColumns === false ? fallbackCleanup : roomControlCleanup;
      let { error: updateError } = await supabase
        .from('meeting_rooms')
        .update(primaryCleanup)
        .eq('id', roomId);

      if (updateError && isMissingRoomControlColumnError(updateError)) {
        canUseRoomControlColumns = false;
        ({ error: updateError } = await supabase
          .from('meeting_rooms')
          .update(fallbackCleanup)
          .eq('id', roomId));
      }

      if (updateError) {
        throw updateError;
      }

      results.push({ roomId, action: 'left' });
      continue;
    }

    const { error: ownerUpdateError } = await supabase
      .from('meeting_rooms')
      .update({
        owner_id: normalizedOwnerId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', roomId);

    if (ownerUpdateError) {
      throw ownerUpdateError;
    }

    const { error: deleteError } = await deleteClient
      .from('meeting_rooms')
      .delete()
      .eq('id', roomId)
      .eq('owner_id', normalizedOwnerId);

    if (deleteError) {
      throw deleteError;
    }

    results.push({ roomId, action: 'deleted' });
  }

  return results;
}

async function loadMeetingRoomControlStateByCode(code: string) {
  const supabase = getClientOrThrow();
  const normalizedCode = code.trim().toUpperCase();
  const { data, error } = await supabase
    .from('meeting_rooms')
    .select(CONTROL_ROOM_SELECT)
    .eq('code', normalizedCode)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  canUseRoomControlColumns = true;
  return mapRoom(data as MeetingRoomRow);
}

export async function loadRoomParticipants(roomId: string) {
  const supabase = getClientOrThrow();

  const loadParticipants = (columns: string) =>
    supabase
      .from('meeting_room_participants')
      .select(columns)
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
  let { data, error } = await loadParticipants(getParticipantSelectColumns());

  for (let attempt = 0; error && attempt < 4; attempt += 1) {
    if (!disableMissingParticipantOptionalColumn(error)) {
      break;
    }

    ({ data, error } = await loadParticipants(getParticipantSelectColumns()));
  }

  if (!error) {
    if (canUseParticipantTravelModeColumn !== false) {
      canUseParticipantTravelModeColumn = true;
    }

    if (canUseParticipantGenderColumn !== false) {
      canUseParticipantGenderColumn = true;
    }

    if (canUseParticipantAvatarColumn !== false) {
      canUseParticipantAvatarColumn = true;
    }
  }

  if (error) {
    throw error;
  }

  return Array.isArray(data)
    ? (data as RoomParticipantRow[]).map((participant) => mapParticipant(participant))
    : [];
}

export async function addRoomParticipant(input: {
  roomId: string;
  participant: Participant;
  userId?: string | null;
}) {
  const supabase = getClientOrThrow();
  const { participant } = input;
  const buildPayload = () => {
    const basePayload = {
      id: participant.id,
      room_id: input.roomId,
      created_by: normalizeNullableUuid(input.userId ?? participant.createdBy),
      name: participant.name,
      location: participant.location,
      latitude: participant.coordinates.lat,
      longitude: participant.coordinates.lng,
      max_travel_time: participant.maxTravelTime,
      location_source: participant.locationSource ?? null,
      saved_friend_id: participant.savedFriendId ?? null,
    };

    return {
      ...basePayload,
      ...(canUseParticipantTravelModeColumn === false
        ? {}
        : { travel_mode: participant.travelMode ?? 'transit' }),
      ...(canUseParticipantGenderColumn === false
        ? {}
        : { gender: normalizeParticipantGender(participant.gender) }),
      ...(canUseParticipantAvatarColumn === false
        ? {}
        : { avatar_url: participant.avatarUrl ?? null }),
    };
  };
  let { error } = await supabase
    .from('meeting_room_participants')
    .upsert(buildPayload(), { onConflict: 'id' });

  for (let attempt = 0; error && attempt < 4; attempt += 1) {
    if (!disableMissingParticipantOptionalColumn(error)) {
      break;
    }

    ({ error } = await supabase
      .from('meeting_room_participants')
      .upsert(buildPayload(), { onConflict: 'id' }));
  }

  if (!error) {
    if (canUseParticipantTravelModeColumn !== false) {
      canUseParticipantTravelModeColumn = true;
    }

    if (canUseParticipantGenderColumn !== false) {
      canUseParticipantGenderColumn = true;
    }

    if (canUseParticipantAvatarColumn !== false) {
      canUseParticipantAvatarColumn = true;
    }
  }

  if (error) {
    throw error;
  }
}

export async function removeRoomParticipant(roomId: string, participantId: string) {
  const supabase = getClientOrThrow();
  const { error } = await supabase
    .from('meeting_room_participants')
    .delete()
    .eq('room_id', roomId)
    .eq('id', participantId);

  if (error) {
    throw error;
  }
}

export async function updateRoomSelection(input: {
  roomId: string;
  selectedCategory: MeetCategoryKey;
  selectedCandidate: Candidate;
}) {
  const supabase = getClientOrThrow();
  const controlReset =
    canUseRoomControlColumns === false
      ? {}
      : {
          draw_controller_id: null,
          redraw_votes: [],
          redraw_requested_at: null,
        };
  let { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      selected_category: input.selectedCategory,
      selected_candidate: input.selectedCandidate,
      status: 'decided',
      updated_at: new Date().toISOString(),
      ...controlReset,
    })
    .eq('id', input.roomId)
    .select(getRoomSelectColumns())
    .single();

  if (error && canUseRoomControlColumns !== false && isMissingRoomControlColumnError(error)) {
    canUseRoomControlColumns = false;
    ({ data, error } = await supabase
      .from('meeting_rooms')
      .update({
        selected_category: input.selectedCategory,
        selected_candidate: input.selectedCandidate,
        status: 'decided',
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.roomId)
      .select(BASE_ROOM_SELECT)
      .single());
  }

  if (error) {
    throw error;
  }

  return mapRoom(data as MeetingRoomRow);
}

export async function updateRoomPlanningCategory(input: {
  roomId: string;
  selectedCategory: MeetCategoryKey;
}) {
  const supabase = getClientOrThrow();
  const controlReset =
    canUseRoomControlColumns === false
      ? {}
      : {
          draw_controller_id: null,
          draw_ready_ids: [],
        };
  let { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      selected_category: input.selectedCategory,
      updated_at: new Date().toISOString(),
      ...controlReset,
    })
    .eq('id', input.roomId)
    .select(getRoomSelectColumns())
    .single();

  if (error && canUseRoomControlColumns !== false && isMissingRoomControlColumnError(error)) {
    canUseRoomControlColumns = false;
    ({ data, error } = await supabase
      .from('meeting_rooms')
      .update({
        selected_category: input.selectedCategory,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.roomId)
      .select(BASE_ROOM_SELECT)
      .single());
  }

  if (error) {
    throw error;
  }

  return mapRoom(data as MeetingRoomRow);
}

export async function resetRoomReadiness(input: {
  roomId: string;
}) {
  if (canUseRoomControlColumns === false) {
    return null as MeetingRoom | null;
  }

  const supabase = getClientOrThrow();
  const { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      draw_controller_id: null,
      draw_ready_ids: [],
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.roomId)
    .select(CONTROL_ROOM_SELECT)
    .single();

  if (error) {
    if (isMissingRoomControlColumnError(error)) {
      canUseRoomControlColumns = false;
      return null;
    }

    throw error;
  }

  canUseRoomControlColumns = true;
  return mapRoom(data as MeetingRoomRow);
}

export async function resetRoomSelection(input: {
  roomId: string;
  selectedCategory: MeetCategoryKey;
  preserveReadiness?: boolean;
}) {
  const supabase = getClientOrThrow();
  const controlReset =
    canUseRoomControlColumns === false
      ? {}
      : input.preserveReadiness
        ? {
            draw_controller_id: null,
            redraw_votes: [],
            redraw_requested_at: null,
          }
        : {
            draw_controller_id: null,
            draw_ready_ids: [],
            redraw_votes: [],
            redraw_requested_at: null,
          };
  let { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      selected_category: input.selectedCategory,
      selected_candidate: null,
      status: 'planning',
      updated_at: new Date().toISOString(),
      ...controlReset,
    })
    .eq('id', input.roomId)
    .select(getRoomSelectColumns())
    .single();

  if (error && canUseRoomControlColumns !== false && isMissingRoomControlColumnError(error)) {
    canUseRoomControlColumns = false;
    ({ data, error } = await supabase
      .from('meeting_rooms')
      .update({
        selected_category: input.selectedCategory,
        selected_candidate: null,
        status: 'planning',
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.roomId)
      .select(BASE_ROOM_SELECT)
      .single());
  }

  if (error) {
    throw error;
  }

  return mapRoom(data as MeetingRoomRow);
}

export async function updateRoomDrawController(input: {
  roomId: string;
  drawControllerId: string;
}) {
  if (canUseRoomControlColumns === false) {
    return null as MeetingRoom | null;
  }

  const supabase = getClientOrThrow();
  const { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      draw_controller_id: input.drawControllerId,
    })
    .eq('id', input.roomId)
    .select(CONTROL_ROOM_SELECT)
    .single();

  if (error) {
    if (isMissingRoomControlColumnError(error)) {
      canUseRoomControlColumns = false;
      return null;
    }

    throw error;
  }

  canUseRoomControlColumns = true;
  return mapRoom(data as MeetingRoomRow);
}

export async function setRoomDrawReady(input: {
  room: MeetingRoom;
  actorId: string;
  ready: boolean;
}) {
  const supabase = getClientOrThrow();
  const { data: rpcData, error: rpcError } = await supabase.rpc('set_room_draw_ready', {
    target_room_id: input.room.id,
    actor_id: input.actorId,
    is_ready: input.ready,
  });

  if (!rpcError && rpcData) {
    canUseRoomControlColumns = true;
    return mapRoom(rpcData as MeetingRoomRow);
  }

  const latestRoom =
    (await loadMeetingRoomControlStateByCode(input.room.code).catch(() => null)) ?? input.room;
  const currentReadyIds = normalizeStringList(latestRoom.drawReadyIds);
  const nextReadyIds = input.ready
    ? [...new Set([...currentReadyIds, input.actorId])]
    : currentReadyIds.filter((readyId) => readyId !== input.actorId);
  const { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      draw_ready_ids: nextReadyIds,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.room.id)
    .select(CONTROL_ROOM_SELECT)
    .single();

  if (error) {
    if (isMissingRoomControlColumnError(error)) {
      canUseRoomControlColumns = false;
      throw new Error(READY_VOTE_SCHEMA_HINT);
    }

    throw error;
  }

  canUseRoomControlColumns = true;
  return mapRoom(data as MeetingRoomRow);
}

export async function requestRoomRedrawVote(input: {
  room: MeetingRoom;
  voterId: string;
}) {
  const supabase = getClientOrThrow();
  const { data: rpcData, error: rpcError } = await supabase.rpc('request_room_redraw_vote', {
    target_room_id: input.room.id,
    voter_id: input.voterId,
  });

  if (!rpcError && rpcData) {
    canUseRoomControlColumns = true;
    return mapRoom(rpcData as MeetingRoomRow);
  }

  const latestRoom =
    (await loadMeetingRoomControlStateByCode(input.room.code).catch(() => null)) ?? input.room;
  const nextVotes = [
    ...new Set([...input.room.redrawVotes, ...latestRoom.redrawVotes, input.voterId]),
  ];
  const { data, error } = await supabase
    .from('meeting_rooms')
    .update({
      redraw_votes: nextVotes,
      redraw_requested_at:
        latestRoom.redrawRequestedAt ?? input.room.redrawRequestedAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.room.id)
    .select(CONTROL_ROOM_SELECT)
    .single();

  if (error) {
    if (isMissingRoomControlColumnError(error)) {
      canUseRoomControlColumns = false;
      throw new Error(READY_VOTE_SCHEMA_HINT);
    }

    throw error;
  }

  canUseRoomControlColumns = true;
  return mapRoom(data as MeetingRoomRow);
}

export function subscribeToRoomParticipants(
  roomId: string,
  onChange: (participants: Participant[]) => void,
  onError?: (message: string) => void,
) {
  const supabase = getSupabasePublicClient();

  if (!supabase) {
    return () => {};
  }

  const reloadParticipants = () => {
    void loadRoomParticipants(roomId)
      .then(onChange)
      .catch((error: Error) => onError?.(error.message));
  };

  const channel = supabase
    .channel(`room-participants-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'meeting_room_participants',
        filter: `room_id=eq.${roomId}`,
      },
      reloadParticipants,
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToRoomState(
  roomId: string,
  onChange: (room: MeetingRoom) => void,
  onError?: (message: string) => void,
) {
  const supabase = getSupabasePublicClient();

  if (!supabase) {
    return () => {};
  }

  const channel = supabase
    .channel(`room-state-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'meeting_rooms',
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        try {
          onChange(mapRoom(payload.new as MeetingRoomRow));
        } catch (error) {
          onError?.(error instanceof Error ? error.message : '방 상태를 읽지 못했습니다.');
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
