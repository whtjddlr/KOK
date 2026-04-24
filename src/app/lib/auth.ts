import type { User } from '@supabase/supabase-js';
import type { Coordinates, LocationSource } from '../types';
import { getSupabaseBrowserClient, isSupabaseConfigured } from './supabase';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  preferences: UserPreferences;
  homeLocation: UserHomeLocation | null;
}

interface StoredAuthUser extends AuthUser {
  passwordHash: string;
}

interface ProfileRow {
  id: string;
  email: string;
  name: string;
  favorite_categories: string[] | null;
  vibe: string | null;
  favorite_keywords: string[] | null;
  home_location?: string | null;
  home_latitude?: number | null;
  home_longitude?: number | null;
  home_location_source?: string | null;
}

export type UserPreferenceVibe = 'trendy' | 'cozy' | 'quiet' | 'lively' | 'local';

export type UserPreferenceCategory =
  | 'restaurant'
  | 'cafe'
  | 'drink'
  | 'culture'
  | 'activity';

export interface UserPreferences {
  favoriteCategories: UserPreferenceCategory[];
  vibe: UserPreferenceVibe;
  favoriteKeywords: string[];
}

export interface UserHomeLocation {
  location: string;
  coordinates: Coordinates;
  locationSource?: LocationSource;
}

export interface ProfileSettingsInput {
  name: string;
  preferences: Partial<UserPreferences>;
  homeLocation?: UserHomeLocation | null;
}

export const preferenceVibeOptions: Array<{ value: UserPreferenceVibe; label: string }> = [
  { value: 'trendy', label: '힙한 곳' },
  { value: 'cozy', label: '감성 위주' },
  { value: 'quiet', label: '조용한 곳' },
  { value: 'lively', label: '활기찬 곳' },
  { value: 'local', label: '로컬 느낌' },
];

export const preferenceCategoryOptions: Array<{
  value: UserPreferenceCategory;
  label: string;
}> = [
  { value: 'restaurant', label: '맛집' },
  { value: 'cafe', label: '카페' },
  { value: 'drink', label: '술/바' },
  { value: 'culture', label: '전시/문화' },
  { value: 'activity', label: '놀거리' },
];

export const preferenceKeywordOptions = [
  '한식',
  '고기',
  '브런치',
  '디저트',
  '와인바',
  '칵테일',
  '전시',
  '산책',
  '방탈출',
  '보드게임',
  '뷰 좋은',
  '가성비',
] as const;

const USERS_KEY = 'randommeet.auth.users';
const SESSION_KEY = 'randommeet.auth.session';
const PROFILE_SETTINGS_KEY_PREFIX = 'randommeet.profile.';
const PROFILE_BASE_SELECT = 'id, email, name, favorite_categories, vibe, favorite_keywords';
const PROFILE_HOME_SELECT = 'home_location, home_latitude, home_longitude, home_location_source';

let canPersistProfileHomeLocation: boolean | null = null;

function withProfileTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs = 2500) {
  return new Promise<T>((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve(fallback);
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(() => resolve(fallback))
      .finally(() => {
        clearTimeout(timeoutId);
      });
  });
}

function getDefaultPreferences(): UserPreferences {
  return {
    favoriteCategories: ['restaurant', 'cafe'],
    vibe: 'trendy',
    favoriteKeywords: ['맛집', '카페'],
  };
}

function normalizePreferences(input?: Partial<UserPreferences> | null): UserPreferences {
  const defaults = getDefaultPreferences();
  const favoriteCategories = Array.isArray(input?.favoriteCategories)
    ? input.favoriteCategories.filter(
        (value): value is UserPreferenceCategory =>
          typeof value === 'string' &&
          preferenceCategoryOptions.some((option) => option.value === value),
      )
    : [];
  const favoriteKeywords = Array.isArray(input?.favoriteKeywords)
    ? input.favoriteKeywords
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .slice(0, 4)
    : [];
  const vibe =
    typeof input?.vibe === 'string' &&
    preferenceVibeOptions.some((option) => option.value === input.vibe)
      ? input.vibe
      : defaults.vibe;

  return {
    favoriteCategories: favoriteCategories.length
      ? favoriteCategories.slice(0, 2)
      : defaults.favoriteCategories,
    vibe,
    favoriteKeywords: favoriteKeywords.length ? favoriteKeywords : defaults.favoriteKeywords,
  };
}

function normalizeHomeLocation(input?: Partial<UserHomeLocation> | null) {
  const location = typeof input?.location === 'string' ? input.location.trim() : '';
  const lat = Number(input?.coordinates?.lat);
  const lng = Number(input?.coordinates?.lng);
  const locationSource =
    input?.locationSource === 'current' ||
    input?.locationSource === 'address' ||
    input?.locationSource === 'map' ||
    input?.locationSource === 'station'
      ? input.locationSource
      : 'address';

  if (!location || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null as UserHomeLocation | null;
  }

  return {
    location,
    coordinates: {
      lat,
      lng,
    },
    locationSource,
  };
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

function readStoredUsers() {
  if (!canUseStorage()) {
    return [] as StoredAuthUser[];
  }

  try {
    const raw = window.localStorage.getItem(USERS_KEY);

    if (!raw) {
      return [] as StoredAuthUser[];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [] as StoredAuthUser[];
    }

    return parsed.map((user) => ({
      ...(user as StoredAuthUser),
      preferences: normalizePreferences((user as StoredAuthUser).preferences),
      homeLocation: normalizeHomeLocation((user as StoredAuthUser).homeLocation),
    }));
  } catch {
    return [] as StoredAuthUser[];
  }
}

function persistStoredUsers(users: StoredAuthUser[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function persistSession(userId: string | null) {
  if (!canUseStorage()) {
    return;
  }

  if (!userId) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }

  window.localStorage.setItem(SESSION_KEY, userId);
}

function getProfileSettingsKey(userId: string) {
  return `${PROFILE_SETTINGS_KEY_PREFIX}${userId}`;
}

function readStoredProfileSettings(userId: string) {
  if (!canUseStorage() || !userId) {
    return undefined as
      | {
          name?: string;
          preferences?: Partial<UserPreferences>;
          homeLocation?: Partial<UserHomeLocation> | null;
        }
      | undefined;
  }

  try {
    const raw = window.localStorage.getItem(getProfileSettingsKey(userId));

    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    return parsed as {
      name?: string;
      preferences?: Partial<UserPreferences>;
      homeLocation?: Partial<UserHomeLocation> | null;
    };
  } catch {
    return undefined;
  }
}

function persistStoredProfileSettings(
  userId: string,
  input: {
    name: string;
    preferences: UserPreferences;
    homeLocation: UserHomeLocation | null;
  },
) {
  if (!canUseStorage() || !userId) {
    return;
  }

  window.localStorage.setItem(getProfileSettingsKey(userId), JSON.stringify(input));
}

async function hashPassword(password: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function getNameFromMetadata(user: User) {
  const metadata = user.user_metadata ?? {};

  return (
    metadata.name ||
    metadata.full_name ||
    metadata.nickname ||
    user.email?.split('@')[0] ||
    '사용자'
  );
}

function getPreferencesFromMetadata(user: User) {
  const metadata = user.user_metadata ?? {};

  return normalizePreferences(metadata.preferences as Partial<UserPreferences> | undefined);
}

function getHomeLocationFromMetadata(user: User) {
  const metadata = user.user_metadata ?? {};

  return normalizeHomeLocation(metadata.homeLocation as Partial<UserHomeLocation> | undefined);
}

function mapProfileRowToPreferences(profile: ProfileRow | null | undefined) {
  if (!profile) {
    return null;
  }

  return normalizePreferences({
    favoriteCategories: profile.favorite_categories as UserPreferenceCategory[] | undefined,
    vibe: profile.vibe as UserPreferenceVibe | undefined,
    favoriteKeywords: profile.favorite_keywords ?? undefined,
  });
}

function mapProfileRowToHomeLocation(profile: ProfileRow | null | undefined) {
  if (!profile) {
    return null;
  }

  return normalizeHomeLocation({
    location: profile.home_location ?? '',
    coordinates: {
      lat: Number(profile.home_latitude),
      lng: Number(profile.home_longitude),
    },
    locationSource: profile.home_location_source as LocationSource | undefined,
  });
}

function mapSupabaseUser(user: User, profile?: ProfileRow | null): AuthUser {
  const profilePreferences = mapProfileRowToPreferences(profile);
  const profileHomeLocation = mapProfileRowToHomeLocation(profile);
  const storedProfile = readStoredProfileSettings(user.id);
  const storedName = typeof storedProfile?.name === 'string' ? storedProfile.name.trim() : '';
  const storedHomeLocation =
    storedProfile && 'homeLocation' in storedProfile
      ? normalizeHomeLocation(storedProfile.homeLocation)
      : undefined;

  return {
    id: user.id,
    name: storedName || profile?.name?.trim() || getNameFromMetadata(user),
    email: user.email ?? profile?.email ?? '',
    preferences: storedProfile?.preferences
      ? normalizePreferences(storedProfile.preferences)
      : profilePreferences ?? getPreferencesFromMetadata(user),
    homeLocation:
      storedHomeLocation !== undefined
        ? storedHomeLocation
        : profileHomeLocation ?? getHomeLocationFromMetadata(user),
  };
}

async function loadProfile(userId: string) {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return null as ProfileRow | null;
  }

  const { data: baseProfile, error: baseError } = await supabase
    .from('profiles')
    .select(PROFILE_BASE_SELECT)
    .eq('id', userId)
    .maybeSingle();

  if (baseError || !baseProfile) {
    return null as ProfileRow | null;
  }

  if (canPersistProfileHomeLocation === false) {
    return baseProfile as ProfileRow;
  }

  const { data: homeProfile, error: homeError } = await supabase
    .from('profiles')
    .select(PROFILE_HOME_SELECT)
    .eq('id', userId)
    .maybeSingle();

  if (homeError) {
    canPersistProfileHomeLocation = false;
    return baseProfile as ProfileRow;
  }

  canPersistProfileHomeLocation = true;

  return {
    ...(baseProfile as ProfileRow),
    ...(homeProfile as Partial<ProfileRow> | null),
  } as ProfileRow;
}

async function upsertProfile(
  user: User,
  name: string,
  preferences: UserPreferences,
  homeLocation?: UserHomeLocation | null,
) {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return null as ProfileRow | null;
  }

  const { data: baseProfile, error: baseError } = await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        email: user.email ?? '',
        name,
        favorite_categories: preferences.favoriteCategories,
        vibe: preferences.vibe,
        favorite_keywords: preferences.favoriteKeywords,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select(PROFILE_BASE_SELECT)
    .single();

  if (baseError || !baseProfile) {
    return null as ProfileRow | null;
  }

  if (canPersistProfileHomeLocation === false) {
    return baseProfile as ProfileRow;
  }

  const { data: homeProfile, error: homeError } = await supabase
    .from('profiles')
    .update({
      home_location: homeLocation?.location ?? null,
      home_latitude: homeLocation?.coordinates.lat ?? null,
      home_longitude: homeLocation?.coordinates.lng ?? null,
      home_location_source: homeLocation?.locationSource ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select(PROFILE_HOME_SELECT)
    .single();

  if (homeError) {
    canPersistProfileHomeLocation = false;
    return baseProfile as ProfileRow;
  }

  canPersistProfileHomeLocation = true;

  return {
    ...(baseProfile as ProfileRow),
    ...(homeProfile as Partial<ProfileRow> | null),
  } as ProfileRow;
}

async function ensureProfile(user: User) {
  const existingProfile = await loadProfile(user.id);

  if (existingProfile) {
    return existingProfile;
  }

  return upsertProfile(
    user,
    getNameFromMetadata(user),
    getPreferencesFromMetadata(user),
    getHomeLocationFromMetadata(user),
  );
}

export async function loadSessionUser() {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return null as AuthUser | null;
    }

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null as AuthUser | null;
    }

    return mapSupabaseUser(data.user);
  }

  if (!canUseStorage()) {
    return null as AuthUser | null;
  }

  const sessionUserId = window.localStorage.getItem(SESSION_KEY);

  if (!sessionUserId) {
    return null as AuthUser | null;
  }

  const matchedUser = readStoredUsers().find((user) => user.id === sessionUserId);

  if (!matchedUser) {
    persistSession(null);
    return null as AuthUser | null;
  }

  return {
    id: matchedUser.id,
    name: matchedUser.name,
    email: matchedUser.email,
    preferences: normalizePreferences(matchedUser.preferences),
    homeLocation: normalizeHomeLocation(matchedUser.homeLocation),
  };
}

export function subscribeToAuthChanges(callback: (user: AuthUser | null) => void) {
  if (!isSupabaseConfigured()) {
    return () => {};
  }

  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return () => {};
  }

  let cancelled = false;
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => {
      if (cancelled) {
        return;
      }

      if (!session?.user) {
        callback(null);
        return;
      }

      callback(mapSupabaseUser(session.user));
    }, 0);
  });

  return () => {
    cancelled = true;
    subscription.unsubscribe();
  };
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();
    await supabase?.auth.signOut();
    return;
  }

  persistSession(null);
}

export async function updateProfileSettings(
  currentUser: AuthUser,
  input: ProfileSettingsInput,
) {
  const name = input.name.trim();
  const preferences = normalizePreferences(input.preferences);
  const homeLocation = normalizeHomeLocation(input.homeLocation);

  if (!name) {
    return { error: '이름을 입력해 주세요.' };
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return { error: 'Supabase 클라이언트를 초기화하지 못했어요.' };
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return { error: '로그인 정보를 다시 확인해 주세요.' };
    }

    const { data: updatedAuth, error: updateError } = await supabase.auth.updateUser({
      data: {
        name,
        preferences,
        homeLocation,
      },
    });

    if (updateError) {
      return { error: updateError.message };
    }

    const authUser = updatedAuth.user ?? authData.user;
    persistStoredProfileSettings(authUser.id, {
      name,
      preferences,
      homeLocation,
    });

    void upsertProfile(authUser, name, preferences, homeLocation);

    return {
      user: {
        ...mapSupabaseUser(authUser),
        homeLocation,
      } satisfies AuthUser,
    };
  }

  const users = readStoredUsers();
  const nextUser = users.find((user) => user.id === currentUser.id);

  if (!nextUser) {
    return { error: '저장된 사용자를 찾지 못했어요.' };
  }

  const updatedUser: StoredAuthUser = {
    ...nextUser,
    name,
    preferences,
    homeLocation,
  };

  persistStoredUsers(users.map((user) => (user.id === currentUser.id ? updatedUser : user)));

  return {
    user: {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      preferences: updatedUser.preferences,
      homeLocation,
    } satisfies AuthUser,
  };
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
  preferences?: Partial<UserPreferences>;
}) {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const password = input.password.trim();
  const preferences = normalizePreferences(input.preferences);

  if (!name) {
    return { error: '이름을 입력해 주세요.' };
  }

  if (!isValidEmail(email)) {
    return { error: '이메일 형식이 올바르지 않아요.' };
  }

  if (password.length < 6) {
    return { error: '비밀번호는 6자 이상으로 입력해 주세요.' };
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return { error: 'Supabase 클라이언트를 초기화하지 못했어요.' };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          preferences,
        },
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      return { error: error.message };
    }

    if (!data.user) {
      return { error: '회원가입 결과를 확인하지 못했어요.' };
    }

    if (!data.session) {
      return {
        error:
          'Supabase Confirm email이 켜져 있어요. 테스트용이면 Authentication에서 Confirm email을 꺼 주세요.',
      };
    }

    persistStoredProfileSettings(data.user.id, {
      name,
      preferences,
      homeLocation: null,
    });

    void upsertProfile(data.user, name, preferences);

    return {
      user: mapSupabaseUser(data.user) satisfies AuthUser,
    };
  }

  const users = readStoredUsers();

  if (users.some((user) => user.email === email)) {
    return { error: '이미 가입된 이메일이에요.' };
  }

  const nextUser: StoredAuthUser = {
    id: `user-${Date.now()}`,
    name,
    email,
    preferences,
    homeLocation: null,
    passwordHash: await hashPassword(password),
  };

  persistStoredUsers([...users, nextUser]);
  persistSession(nextUser.id);

  return {
    user: {
      id: nextUser.id,
      name: nextUser.name,
      email: nextUser.email,
      preferences: normalizePreferences(nextUser.preferences),
      homeLocation: null,
    } satisfies AuthUser,
  };
}

export async function signIn(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const password = input.password.trim();

  if (!isValidEmail(email)) {
    return { error: '이메일 형식이 올바르지 않아요.' };
  }

  if (!password) {
    return { error: '비밀번호를 입력해 주세요.' };
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return { error: 'Supabase 클라이언트를 초기화하지 못했어요.' };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: error.message };
    }

    if (!data.user) {
      return { error: '로그인 결과를 확인하지 못했어요.' };
    }

    return {
      user: mapSupabaseUser(data.user) satisfies AuthUser,
    };
  }

  const users = readStoredUsers();
  const matchedUser = users.find((user) => user.email === email);

  if (!matchedUser) {
    return { error: '가입한 계정을 찾지 못했어요.' };
  }

  const passwordHash = await hashPassword(password);

  if (matchedUser.passwordHash !== passwordHash) {
    return { error: '비밀번호가 맞지 않아요.' };
  }

  persistSession(matchedUser.id);

  return {
    user: {
      id: matchedUser.id,
      name: matchedUser.name,
      email: matchedUser.email,
      preferences: normalizePreferences(matchedUser.preferences),
      homeLocation: normalizeHomeLocation(matchedUser.homeLocation),
    } satisfies AuthUser,
  };
}
