import { RuntimeAiConfig } from '../types';

const AI_CONFIG_STORAGE_KEY = 'randommeet.ai-config';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadRuntimeAiConfig() {
  if (!canUseStorage()) {
    return null as RuntimeAiConfig | null;
  }

  try {
    const raw = window.localStorage.getItem(AI_CONFIG_STORAGE_KEY);

    if (!raw) {
      return null as RuntimeAiConfig | null;
    }

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      (parsed.provider !== 'gms' &&
        parsed.provider !== 'upstage' &&
        parsed.provider !== 'openai') ||
      typeof parsed.apiKey !== 'string' ||
      typeof parsed.model !== 'string' ||
      (parsed.provider === 'gms' && typeof parsed.baseUrl !== 'string')
    ) {
      return null as RuntimeAiConfig | null;
    }

    return {
      provider: parsed.provider,
      apiKey: parsed.apiKey,
      model: parsed.model,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
    } satisfies RuntimeAiConfig;
  } catch {
    return null as RuntimeAiConfig | null;
  }
}

export function persistRuntimeAiConfig(config: RuntimeAiConfig) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export function clearRuntimeAiConfig() {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(AI_CONFIG_STORAGE_KEY);
}

export function getRuntimeAiConfigSignature(config: RuntimeAiConfig | null) {
  if (!config?.apiKey) {
    return 'none';
  }

  return `${config.provider}:${config.model}:${config.baseUrl ?? ''}:${config.apiKey.length}:${config.apiKey.slice(-6)}`;
}
