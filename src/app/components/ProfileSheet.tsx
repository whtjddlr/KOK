import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, LoaderCircle, MapPin, Search, Trash2, X } from 'lucide-react';
import {
  AuthUser,
  MAX_FAVORITE_CATEGORIES,
  MAX_FAVORITE_KEYWORDS,
  preferenceCategoryOptions,
  preferenceKeywordOptions,
  preferenceVibeOptions,
  ProfileSettingsInput,
  UserHomeLocation,
  UserPreferenceCategory,
  UserPreferenceVibe,
} from '../lib/auth';
import { participantGenderOptions } from '../lib/gender';
import type { ParticipantGender } from '../types';
import { searchAddress, type AddressSearchResult } from '../lib/naver-map';
import {
  filterSupportedServiceAreaResults,
  getAddressResultLocationLabel,
  getSafeLocationLabel,
  isSupportedServiceAreaLocation,
  looksLikeUnsupportedServiceAreaQuery,
  SERVICE_AREA_UNSUPPORTED_MESSAGE,
} from '../lib/service-area';

interface ProfileSheetProps {
  open: boolean;
  currentUser: AuthUser | null;
  onClose: () => void;
  onSave: (input: ProfileSettingsInput) => Promise<{ user?: AuthUser; error?: string }>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        window.clearTimeout(timeoutId);
      });
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('이미지를 읽지 못했어요.'));
    };
    reader.onerror = () => reject(new Error('이미지를 읽지 못했어요.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('이미지 파일을 확인하지 못했어요.'));
    image.src = src;
  });
}

async function createAvatarPreview(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 올릴 수 있어요.');
  }

  if (file.size > 8 * 1024 * 1024) {
    throw new Error('8MB 이하의 이미지를 선택해 주세요.');
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const size = 320;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('이미지를 처리하지 못했어요.');
  }

  canvas.width = size;
  canvas.height = size;

  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = (image.naturalWidth - sourceSize) / 2;
  const sourceY = (image.naturalHeight - sourceSize) / 2;

  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);

  return canvas.toDataURL('image/jpeg', 0.82);
}

export function ProfileSheet({ open, currentUser, onClose, onSave }: ProfileSheetProps) {
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [favoriteCategories, setFavoriteCategories] = useState<UserPreferenceCategory[]>([]);
  const [favoriteKeywords, setFavoriteKeywords] = useState<string[]>([]);
  const [vibe, setVibe] = useState<UserPreferenceVibe>('trendy');
  const [gender, setGender] = useState<ParticipantGender>('unspecified');
  const [homeLocation, setHomeLocation] = useState<UserHomeLocation | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<AddressSearchResult[]>([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAvatarProcessing, setIsAvatarProcessing] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !currentUser) {
      setError(null);
      setIsSaving(false);
      return;
    }

    setName(currentUser.name);
    setAvatarUrl(currentUser.avatarUrl ?? null);
    setFavoriteCategories(currentUser.preferences.favoriteCategories);
    setFavoriteKeywords(currentUser.preferences.favoriteKeywords);
    setVibe(currentUser.preferences.vibe);
    setGender(currentUser.gender ?? 'unspecified');
    setHomeLocation(currentUser.homeLocation);
    setLocationQuery(currentUser.homeLocation?.location ?? '');
    setLocationResults([]);
    setError(null);
    setSuccess(null);
    setIsSaving(false);
  }, [currentUser, open]);

  if (!open || !currentUser) {
    return null;
  }

  const toggleCategory = (category: UserPreferenceCategory) => {
    setFavoriteCategories((current) => {
      if (current.includes(category)) {
        return current.length === 1 ? current : current.filter((item) => item !== category);
      }

      if (current.length >= MAX_FAVORITE_CATEGORIES) {
        return [...current.slice(1), category];
      }

      return [...current, category];
    });
  };

  const toggleKeyword = (keyword: string) => {
    setFavoriteKeywords((current) => {
      if (current.includes(keyword)) {
        return current.filter((item) => item !== keyword);
      }

      if (current.length >= MAX_FAVORITE_KEYWORDS) {
        return [...current.slice(1), keyword];
      }

      return [...current, keyword];
    });
  };

  const handleSave = async () => {
    if (homeLocation && !isSupportedServiceAreaLocation(homeLocation)) {
      setError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await withTimeout(
        onSave({
          name,
          avatarUrl,
          gender,
          preferences: {
            favoriteCategories,
            favoriteKeywords,
            vibe,
          },
          homeLocation,
        }),
        8000,
        '프로필 저장 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.',
      );

      if (result.error || !result.user) {
        setError(result.error ?? '프로필을 저장하지 못했어요.');
        return;
      }

      setSuccess('내 정보가 저장됐어요.');
      window.setTimeout(onClose, 650);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : '프로필을 저장하지 못했어요.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarChange = async (file?: File | null) => {
    if (!file) {
      return;
    }

    setIsAvatarProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      setAvatarUrl(await createAvatarPreview(file));
      setSuccess('프로필 사진이 준비됐어요. 저장을 눌러 확정해 주세요.');
    } catch (avatarError) {
      setError(
        avatarError instanceof Error
          ? avatarError.message
          : '프로필 사진을 처리하지 못했어요.',
      );
    } finally {
      setIsAvatarProcessing(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
    }
  };

  const handleLocationSearch = async () => {
    const query = locationQuery.trim();

    if (!query) {
      setError('저장할 출발지를 먼저 입력해 주세요.');
      return;
    }

    setIsSearchingLocation(true);
    setError(null);
    setSuccess(null);
    setLocationResults([]);

    try {
      if (looksLikeUnsupportedServiceAreaQuery(query)) {
        setError(SERVICE_AREA_UNSUPPORTED_MESSAGE);
        return;
      }

      const rawResults = await searchAddress(query);
      const results = filterSupportedServiceAreaResults(rawResults);

      if (!results.length) {
        setError(
          rawResults.length
            ? SERVICE_AREA_UNSUPPORTED_MESSAGE
            : '위치 검색 결과가 없어요. 역 이름이나 장소명으로 다시 검색해 주세요.',
        );
        return;
      }

      setLocationResults(results.slice(0, 5));
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : '위치 검색 중 오류가 발생했어요.',
      );
    } finally {
      setIsSearchingLocation(false);
    }
  };

  const handleSelectLocation = (result: AddressSearchResult) => {
    const locationLabel = getAddressResultLocationLabel(result);

    setHomeLocation({
      location: locationLabel,
      coordinates: result.coordinates,
      locationSource: 'address',
    });
    setLocationQuery(locationLabel);
    setLocationResults([]);
    setError(null);
    setSuccess('기본 출발지가 선택됐어요. 저장을 눌러 확정해 주세요.');
  };

  return (
    <div className="fixed inset-0 z-[120] isolate flex items-end justify-center bg-[#f5f1eb] px-4 pb-4 pt-10">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl text-[#1a1a2e]">내 프로필</div>
            <div className="mt-1 text-sm text-[#6b7280]">
              내 출발지와 취향을 저장해 다음 약속에 바로 써요.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f1eb] text-[#44505b]"
            aria-label="프로필 닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="rounded-[24px] bg-[#f9f7f4] p-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#1f2a44] text-2xl font-black text-white shadow-[0_12px_30px_rgba(26,26,46,0.14)] transition-transform active:scale-95"
                aria-label="프로필 사진 선택"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{name.trim().charAt(0) || currentUser.name.charAt(0)}</span>
                )}
                <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#ff7b6b] text-white">
                  {isAvatarProcessing ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                </span>
              </button>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#1a1a2e]">프로필 사진</div>
                <div className="mt-1 text-xs leading-relaxed text-[#8a94a2]">
                  정사각형으로 작게 줄여 저장해요.
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={isAvatarProcessing}
                    className="h-9 rounded-full bg-white px-3 text-xs font-semibold text-[#1f2a44] shadow-sm transition-transform active:scale-95 disabled:opacity-60"
                  >
                    사진 선택
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setAvatarUrl(null);
                        setSuccess(null);
                      }}
                      className="h-9 rounded-full bg-white px-3 text-xs font-semibold text-[#8a94a2] shadow-sm transition-transform active:scale-95"
                    >
                      삭제
                    </button>
                  )}
                </div>
              </div>

              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void handleAvatarChange(event.target.files?.[0]);
                }}
              />
            </div>
          </div>

          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="닉네임"
            className="h-12 w-full rounded-2xl bg-[#f9f7f4] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:ring-2 focus:ring-[#2d3561]/20"
          />

          <div className="rounded-2xl bg-[#f9f7f4] px-4 py-3">
            <div className="mb-2 text-xs text-[#8a94a2]">성별</div>
            <div className="flex flex-wrap gap-2">
              {participantGenderOptions.map((option) => {
                const active = gender === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setGender(option.value)}
                    className={`rounded-full px-3 py-1.5 text-xs transition-all ${
                      active ? 'bg-[#1f2a44] text-white shadow-sm' : 'bg-white text-[#44505b]'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl bg-[#f9f7f4] px-4 py-3">
            <div className="text-xs text-[#8a94a2]">계정 아이디</div>
            <div className="mt-1 text-sm text-[#1a1a2e]">
              {currentUser.loginId || currentUser.email}
            </div>
          </div>

          <div className="rounded-[24px] border border-[#e8edf3] bg-[#f8fbfd] p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm text-[#1a1a2e]">
                  <MapPin className="h-4 w-4 text-[#ff7b6b]" />
                  기본 출발지
                </div>
                <div className="mt-1 text-xs text-[#8a94a2]">
                  약속방에서 내 위치를 한 번에 추가할 때 사용해요.
                </div>
              </div>
              {homeLocation && (
                <button
                  type="button"
                  onClick={() => {
                    setHomeLocation(null);
                    setLocationQuery('');
                    setLocationResults([]);
                    setSuccess(null);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#8a94a2] transition-colors hover:text-[#d95f4d]"
                  aria-label="기본 출발지 삭제"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {homeLocation && (
              <div className="mb-3 rounded-2xl bg-white px-4 py-3">
                <div className="text-sm text-[#1a1a2e]">
                  {getSafeLocationLabel(homeLocation.location)}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={locationQuery}
                onChange={(event) => {
                  setLocationQuery(event.target.value);
                  setError(null);
                  setSuccess(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleLocationSearch();
                  }
                }}
                placeholder="내 출발지 검색"
                className="h-11 flex-1 rounded-2xl border border-[#edf1f4] bg-white px-4 text-sm text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:border-[#d8e0ea] focus:ring-2 focus:ring-[#2d3561]/10"
              />
              <button
                type="button"
                onClick={() => {
                  void handleLocationSearch();
                }}
                disabled={isSearchingLocation}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#eef4ff] px-4 text-sm text-[#2d5aa7] transition-transform active:scale-95 disabled:opacity-60"
              >
                {isSearchingLocation ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                검색
              </button>
            </div>

            {locationResults.length > 0 && (
              <div className="mt-3 space-y-2">
                {locationResults.map((result) => (
                  <button
                    key={`${result.title}-${result.coordinates.lat}-${result.coordinates.lng}`}
                    type="button"
                    onClick={() => handleSelectLocation(result)}
                    className="w-full rounded-2xl border border-[#e8edf3] bg-white px-4 py-3 text-left transition-all hover:border-[#2d3561]"
                  >
                    <div className="text-sm text-[#1a1a2e]">
                      {getAddressResultLocationLabel(result)}
                    </div>
                    {(result.roadAddress || result.jibunAddress) && (
                      <div className="mt-1 text-xs text-[#6b7280]">
                        {result.roadAddress || result.jibunAddress}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 space-y-4 rounded-[24px] bg-[#faf7f2] p-4">
          <div>
            <div className="flex items-center justify-between text-sm text-[#1a1a2e]">
              <span>자주 찾는 카테고리</span>
              <span className="text-xs text-[#8a94a2]">최대 {MAX_FAVORITE_CATEGORIES}개</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {preferenceCategoryOptions.map((option) => {
                const active = favoriteCategories.includes(option.value);

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleCategory(option.value)}
                    className={`rounded-full px-4 py-2 text-sm transition-all ${
                      active ? 'bg-[#1f2a44] text-white shadow-sm' : 'bg-white text-[#44505b]'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-sm text-[#1a1a2e]">좋아하는 분위기</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {preferenceVibeOptions.map((option) => {
                const active = vibe === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setVibe(option.value)}
                    className={`rounded-full px-4 py-2 text-sm transition-all ${
                      active ? 'bg-[#ff7b6b] text-white shadow-sm' : 'bg-white text-[#44505b]'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm text-[#1a1a2e]">
              <span>관심 키워드</span>
              <span className="text-xs text-[#8a94a2]">최대 {MAX_FAVORITE_KEYWORDS}개</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {preferenceKeywordOptions.map((keyword) => {
                const active = favoriteKeywords.includes(keyword);

                return (
                  <button
                    key={keyword}
                    type="button"
                    onClick={() => toggleKeyword(keyword)}
                    className={`rounded-full px-4 py-2 text-sm transition-all ${
                      active ? 'bg-[#2d3561] text-white shadow-sm' : 'bg-white text-[#44505b]'
                    }`}
                  >
                    {keyword}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-[#ffd9cf] bg-[#fff5f2] px-4 py-3 text-sm text-[#c15b3d]">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[#d8f3e8] bg-[#f0fdf8] px-4 py-3 text-sm text-[#107569]">
            <CheckCircle2 className="h-4 w-4" />
            {success}
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1f2a44] text-white transition-transform active:scale-95 disabled:opacity-60"
        >
          {isSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
          프로필 저장
        </button>
      </div>
    </div>
  );
}
