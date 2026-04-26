import { Participant, SavedFriend } from '../types';
import { normalizeParticipantGender } from './gender';

const SAVED_FRIENDS_KEY_PREFIX = 'randommeet.saved-friends.';
export const DEFAULT_MAX_TRAVEL_TIME = 45;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getSavedFriendsKey(userId: string) {
  return `${SAVED_FRIENDS_KEY_PREFIX}${userId}`;
}

function loadSavedFriendsFromStorage(userId: string) {
  if (!canUseStorage() || !userId) {
    return [] as SavedFriend[];
  }

  try {
    const raw = window.localStorage.getItem(getSavedFriendsKey(userId));

    if (!raw) {
      return [] as SavedFriend[];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [] as SavedFriend[];
    }

    return parsed.map((friend) => ({
      ...(friend as SavedFriend),
      gender: normalizeParticipantGender((friend as Partial<SavedFriend>).gender),
    }));
  } catch {
    return [] as SavedFriend[];
  }
}

function persistSavedFriendsToStorage(userId: string, friends: SavedFriend[]) {
  if (!canUseStorage() || !userId) {
    return;
  }

  window.localStorage.setItem(getSavedFriendsKey(userId), JSON.stringify(friends));
}

export async function loadSavedFriends(userId: string) {
  if (!userId) {
    return [] as SavedFriend[];
  }

  return loadSavedFriendsFromStorage(userId);
}

export async function persistSavedFriends(userId: string, friends: SavedFriend[]) {
  if (!userId) {
    return;
  }

  persistSavedFriendsToStorage(userId, friends);
}

export function buildSavedFriendFromParticipant(participant: Participant): SavedFriend {
  return {
    id: participant.savedFriendId ?? `friend-${participant.name}-${participant.location}`.replace(/\s+/g, '-'),
    name: participant.name,
    location: participant.location,
    coordinates: participant.coordinates,
    maxTravelTime: DEFAULT_MAX_TRAVEL_TIME,
    travelMode: participant.travelMode ?? 'transit',
    gender: normalizeParticipantGender(participant.gender),
    locationSource: participant.locationSource,
  };
}

export function upsertSavedFriend(friends: SavedFriend[], nextFriend: SavedFriend) {
  const filtered = friends.filter((friend) => friend.id !== nextFriend.id);

  return [...filtered, nextFriend].sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}

export function createParticipantFromSavedFriend(friend: SavedFriend): Participant {
  return {
    id: `${friend.id}-${Date.now()}`,
    name: friend.name,
    location: friend.location,
    coordinates: friend.coordinates,
    maxTravelTime: friend.maxTravelTime || DEFAULT_MAX_TRAVEL_TIME,
    travelMode: friend.travelMode ?? 'transit',
    gender: normalizeParticipantGender(friend.gender),
    locationSource: friend.locationSource,
    savedFriendId: friend.id,
  };
}
