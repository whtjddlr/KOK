import { Participant, SavedFriend } from '../types';
import { getSupabaseBrowserClient, isSupabaseConfigured } from './supabase';

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

    return parsed as SavedFriend[];
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

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();

    if (supabase) {
      const { data, error } = await supabase
        .from('saved_friends')
        .select(
          'id, name, location, latitude, longitude, max_travel_time, location_source',
        )
        .eq('user_id', userId)
        .order('name', { ascending: true });

      if (!error && Array.isArray(data)) {
        const friends = data.map<SavedFriend>((item) => ({
          id: item.id,
          name: item.name,
          location: item.location,
          coordinates: {
            lat: Number(item.latitude),
            lng: Number(item.longitude),
          },
          maxTravelTime: Number(item.max_travel_time) || DEFAULT_MAX_TRAVEL_TIME,
          locationSource: item.location_source ?? undefined,
        }));

        persistSavedFriendsToStorage(userId, friends);
        return friends;
      }
    }
  }

  return loadSavedFriendsFromStorage(userId);
}

export async function persistSavedFriends(userId: string, friends: SavedFriend[]) {
  if (!userId) {
    return;
  }

  persistSavedFriendsToStorage(userId, friends);

  if (!isSupabaseConfigured()) {
    return;
  }

  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return;
  }

  const { error: deleteError } = await supabase.from('saved_friends').delete().eq('user_id', userId);

  if (deleteError) {
    return;
  }

  if (!friends.length) {
    return;
  }

  await supabase.from('saved_friends').insert(
    friends.map((friend) => ({
      id: friend.id,
      user_id: userId,
      name: friend.name,
      location: friend.location,
      latitude: friend.coordinates.lat,
      longitude: friend.coordinates.lng,
      max_travel_time: friend.maxTravelTime || DEFAULT_MAX_TRAVEL_TIME,
      location_source: friend.locationSource ?? null,
    })),
  );
}

export function buildSavedFriendFromParticipant(participant: Participant): SavedFriend {
  return {
    id: participant.savedFriendId ?? `friend-${participant.name}-${participant.location}`.replace(/\s+/g, '-'),
    name: participant.name,
    location: participant.location,
    coordinates: participant.coordinates,
    maxTravelTime: DEFAULT_MAX_TRAVEL_TIME,
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
    locationSource: friend.locationSource,
    savedFriendId: friend.id,
  };
}
