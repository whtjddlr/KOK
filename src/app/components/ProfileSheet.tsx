import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle, MapPin, Search, Trash2, X } from 'lucide-react';
import {
  AuthUser,
  preferenceCategoryOptions,
  preferenceKeywordOptions,
  preferenceVibeOptions,
  ProfileSettingsInput,
  UserHomeLocation,
  UserPreferenceCategory,
  UserPreferenceVibe,
} from '../lib/auth';
import { searchAddress, type AddressSearchResult } from '../lib/naver-map';

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

export function ProfileSheet({ open, currentUser, onClose, onSave }: ProfileSheetProps) {
  const [name, setName] = useState('');
  const [favoriteCategories, setFavoriteCategories] = useState<UserPreferenceCategory[]>([]);
  const [favoriteKeywords, setFavoriteKeywords] = useState<string[]>([]);
  const [vibe, setVibe] = useState<UserPreferenceVibe>('trendy');
  const [homeLocation, setHomeLocation] = useState<UserHomeLocation | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<AddressSearchResult[]>([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || !currentUser) {
      setError(null);
      setIsSaving(false);
      return;
    }

    setName(currentUser.name);
    setFavoriteCategories(currentUser.preferences.favoriteCategories);
    setFavoriteKeywords(currentUser.preferences.favoriteKeywords);
    setVibe(currentUser.preferences.vibe);
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

      if (current.length >= 2) {
        return [current[1], category];
      }

      return [...current, category];
    });
  };

  const toggleKeyword = (keyword: string) => {
    setFavoriteKeywords((current) => {
      if (current.includes(keyword)) {
        return current.filter((item) => item !== keyword);
      }

      if (current.length >= 4) {
        return [...current.slice(1), keyword];
      }

      return [...current, keyword];
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await withTimeout(
        onSave({
          name,
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
      const results = await searchAddress(query);

      if (!results.length) {
        setError('위치 검색 결과가 없어요. 역 이름이나 장소명으로 다시 검색해 주세요.');
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
    setHomeLocation({
      location: result.title,
      coordinates: result.coordinates,
      locationSource: 'address',
    });
    setLocationQuery(result.title);
    setLocationResults([]);
    setError(null);
    setSuccess('기본 출발지가 선택됐어요. 저장을 눌러 확정해 주세요.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(18,28,45,0.42)] px-4 pb-4 pt-10 backdrop-blur-sm">
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
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="이름"
            className="h-12 w-full rounded-2xl bg-[#f9f7f4] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:ring-2 focus:ring-[#2d3561]/20"
          />

          <div className="rounded-2xl bg-[#f9f7f4] px-4 py-3">
            <div className="text-xs text-[#8a94a2]">이메일</div>
            <div className="mt-1 text-sm text-[#1a1a2e]">{currentUser.email}</div>
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
                <div className="text-sm text-[#1a1a2e]">{homeLocation.location}</div>
                <div className="mt-1 text-xs text-[#8a94a2]">
                  {homeLocation.coordinates.lat.toFixed(4)}, {homeLocation.coordinates.lng.toFixed(4)}
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
                    <div className="text-sm text-[#1a1a2e]">{result.title}</div>
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
              <span className="text-xs text-[#8a94a2]">최대 2개</span>
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
              <span className="text-xs text-[#8a94a2]">최대 4개</span>
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
