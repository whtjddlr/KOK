import { useEffect, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import {
  AuthUser,
  preferenceCategoryOptions,
  preferenceKeywordOptions,
  preferenceVibeOptions,
  signIn,
  signUp,
  UserPreferenceCategory,
  UserPreferenceVibe,
} from '../lib/auth';

export type AuthMode = 'signup' | 'login';

interface AuthSheetProps {
  open: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

const DEFAULT_SIGNUP_CATEGORIES: UserPreferenceCategory[] = ['restaurant', 'cafe'];
const DEFAULT_SIGNUP_KEYWORDS = ['맛집', '카페'];

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

export function AuthSheet({
  open,
  mode,
  onModeChange,
  onClose,
  onSuccess,
}: AuthSheetProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [favoriteCategories, setFavoriteCategories] = useState<UserPreferenceCategory[]>(
    DEFAULT_SIGNUP_CATEGORIES,
  );
  const [favoriteKeywords, setFavoriteKeywords] = useState<string[]>(DEFAULT_SIGNUP_KEYWORDS);
  const [vibe, setVibe] = useState<UserPreferenceVibe>('trendy');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setEmail('');
      setPassword('');
      setFavoriteCategories(DEFAULT_SIGNUP_CATEGORIES);
      setFavoriteKeywords(DEFAULT_SIGNUP_KEYWORDS);
      setVibe('trendy');
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  if (!open) {
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

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await withTimeout(
        mode === 'signup'
          ? signUp({
              name,
              email,
              password,
              preferences: {
                favoriteCategories,
                favoriteKeywords,
                vibe,
              },
            })
          : signIn({ email, password }),
        8000,
        '인증 서버 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.',
      );

      if (result.error || !result.user) {
        setError(result.error ?? '다시 시도해 주세요.');
        return;
      }

      onSuccess(result.user);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : '인증 요청을 완료하지 못했어요.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(18,28,45,0.42)] px-4 pb-4 pt-10 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl text-[#1a1a2e]">
              {mode === 'signup' ? '회원가입' : '로그인'}
            </div>
            <div className="mt-1 text-sm text-[#6b7280]">
              {mode === 'signup'
                ? '취향을 같이 저장해두면 다음 추천이 더 빨라져요.'
                : '저장한 취향과 친구 목록으로 바로 이어서 시작할 수 있어요.'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f1eb] text-[#44505b]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-[#f5f1eb] p-1">
          <button
            onClick={() => onModeChange('signup')}
            className={`h-11 rounded-[18px] text-sm transition-all ${
              mode === 'signup' ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#6b7280]'
            }`}
          >
            회원가입
          </button>
          <button
            onClick={() => onModeChange('login')}
            className={`h-11 rounded-[18px] text-sm transition-all ${
              mode === 'login' ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#6b7280]'
            }`}
          >
            로그인
          </button>
        </div>

        <div className="space-y-3">
          {mode === 'signup' && (
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="이름"
              className="h-12 w-full rounded-2xl bg-[#f9f7f4] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:ring-2 focus:ring-[#2d3561]/20"
            />
          )}
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="이메일"
            className="h-12 w-full rounded-2xl bg-[#f9f7f4] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:ring-2 focus:ring-[#2d3561]/20"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="비밀번호"
            className="h-12 w-full rounded-2xl bg-[#f9f7f4] px-4 text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] focus:ring-2 focus:ring-[#2d3561]/20"
          />
        </div>

        {mode === 'signup' && (
          <div className="mt-5 space-y-4 rounded-[24px] bg-[#faf7f2] p-4">
            <div>
              <div className="text-sm text-[#1a1a2e]">자주 찾는 카테고리</div>
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
              <div className="text-sm text-[#1a1a2e]">관심 키워드</div>
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
        )}

        {error && (
          <div className="mt-4 rounded-2xl border border-[#ffd9cf] bg-[#fff5f2] px-4 py-3 text-sm text-[#c15b3d]">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1f2a44] text-white transition-transform active:scale-95 disabled:opacity-60"
        >
          {isSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {mode === 'signup' ? '취향 저장하고 시작' : '로그인하고 시작'}
        </button>
      </div>
    </div>
  );
}
