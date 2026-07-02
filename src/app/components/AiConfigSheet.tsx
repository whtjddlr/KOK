import { useEffect, useState } from 'react';
import { Bot, KeyRound, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { AiProvider, RuntimeAiConfig } from '../types';

interface AiConfigSheetProps {
  open: boolean;
  initialConfig: RuntimeAiConfig | null;
  onClose: () => void;
  onSave: (config: RuntimeAiConfig) => void;
  onClear: () => void;
}

const providerPresets: Record<AiProvider, { label: string; model: string; baseUrl?: string }> = {
  gms: {
    label: 'GMS AI',
    model: '',
  },
  upstage: {
    label: 'Upstage',
    model: 'solar-pro3',
    baseUrl: 'https://api.upstage.ai/v1',
  },
  openai: {
    label: 'OpenAI',
    model: 'gpt-4o-mini',
  },
};

export function AiConfigSheet({
  open,
  initialConfig,
  onClose,
  onSave,
  onClear,
}: AiConfigSheetProps) {
  const [provider, setProvider] = useState<AiProvider>('upstage');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(providerPresets.upstage.model);
  const [baseUrl, setBaseUrl] = useState(providerPresets.upstage.baseUrl ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextProvider = initialConfig?.provider ?? 'upstage';

    setProvider(nextProvider);
    setApiKey(initialConfig?.apiKey ?? '');
    setModel(initialConfig?.model ?? providerPresets[nextProvider].model);
    setBaseUrl(initialConfig?.baseUrl ?? providerPresets[nextProvider].baseUrl ?? '');
    setIsSaving(false);
  }, [initialConfig, open]);

  if (!open) {
    return null;
  }

  const handleProviderChange = (nextProvider: AiProvider) => {
    setProvider(nextProvider);
    setModel(providerPresets[nextProvider].model);
    setBaseUrl(providerPresets[nextProvider].baseUrl ?? '');
  };

  const handleSave = () => {
    const nextBaseUrl = baseUrl.trim() || providerPresets[provider].baseUrl;

    if (!apiKey.trim() || !model.trim() || (provider !== 'openai' && !nextBaseUrl)) {
      return;
    }

    setIsSaving(true);

    onSave({
      provider,
      apiKey: apiKey.trim(),
      model: model.trim(),
      baseUrl: provider !== 'openai' ? nextBaseUrl : undefined,
    });

    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(18,28,45,0.42)] px-4 pb-4 pt-10 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl text-[#16241D]">AI 연결</div>
            <div className="mt-1 text-sm leading-relaxed text-[#6E7C75]">
              이 기기에서만 쓰는 로컬 설정입니다. GMS AI, Upstage, OpenAI 키를 붙이면 후보군을 AI가 먼저 골라줘요.
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFFFFF] text-[#44505b]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 rounded-2xl bg-[#FFFFFF] p-1">
          {(['gms', 'upstage', 'openai'] as AiProvider[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleProviderChange(option)}
              className={`h-11 rounded-[18px] text-sm transition-all ${
                provider === option ? 'bg-white text-[#16241D] shadow-sm' : 'text-[#6E7C75]'
              }`}
            >
              {providerPresets[option].label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-[#E4EFE9] bg-[#F5F9F7] px-4 py-3 text-sm text-[#44505b]">
            <div className="flex items-center gap-2 text-[#16241D]">
              <Bot className="h-4 w-4 text-[#16241D]" />
              <span>{providerPresets[provider].label}를 후보 생성용으로 연결합니다.</span>
            </div>
          </div>

          <div className="rounded-2xl bg-[#F5F9F7] px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm text-[#44505b]">
              <KeyRound className="h-4 w-4 text-[#16241D]" />
              <span>API Key</span>
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={provider === 'gms' ? 'S00...' : provider === 'upstage' ? 'up_...' : 'sk-...'}
              className="h-11 w-full rounded-xl bg-white px-4 text-[#16241D] outline-none placeholder:text-[#9AA8A1] focus:ring-2 focus:ring-[#16241D]/20"
            />
          </div>

          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="모델 이름"
            className="h-12 w-full rounded-2xl bg-[#F5F9F7] px-4 text-[#16241D] outline-none placeholder:text-[#9AA8A1] focus:ring-2 focus:ring-[#16241D]/20"
          />

          {provider !== 'openai' && (
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={provider === 'gms' ? 'GMS AI API base URL' : 'https://api.upstage.ai/v1'}
              className="h-12 w-full rounded-2xl bg-[#F5F9F7] px-4 text-[#16241D] outline-none placeholder:text-[#9AA8A1] focus:ring-2 focus:ring-[#16241D]/20"
            />
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={
              isSaving ||
              !apiKey.trim() ||
              !model.trim() ||
              (provider !== 'openai' && !(baseUrl.trim() || providerPresets[provider].baseUrl))
            }
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#16241D] text-white transition-transform active:scale-95 disabled:opacity-60"
          >
            {isSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            연결 저장
          </button>
          <button
            type="button"
            onClick={onClear}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#FFFFFF] px-4 text-sm text-[#44505b] transition-transform active:scale-95"
          >
            <RotateCcw className="h-4 w-4" />
            해제
          </button>
        </div>
      </div>
    </div>
  );
}
