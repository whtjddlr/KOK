import { useEffect, useState } from 'react';

interface RuntimeCapabilitiesResponse {
  ai?: {
    connected?: boolean;
    provider?: 'upstage' | 'openai' | null;
    model?: string | null;
  };
  naverSearch?: {
    connected?: boolean;
  };
}

interface RuntimeCapabilitiesState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  ai: {
    connected: boolean;
    provider: 'upstage' | 'openai' | null;
    model: string | null;
  };
  naverSearch: {
    connected: boolean;
  };
}

const initialState: RuntimeCapabilitiesState = {
  status: 'idle',
  ai: {
    connected: false,
    provider: null,
    model: null,
  },
  naverSearch: {
    connected: false,
  },
};

export function useRuntimeCapabilities() {
  const [state, setState] = useState<RuntimeCapabilitiesState>({
    ...initialState,
    status: 'loading',
  });

  useEffect(() => {
    let active = true;

    fetch('/api/runtime-capabilities')
      .then(async (response) => {
        const data = (await response.json()) as RuntimeCapabilitiesResponse;

        if (!response.ok) {
          throw new Error('런타임 API 상태를 불러오지 못했습니다.');
        }

        if (!active) {
          return;
        }

        setState({
          status: 'ready',
          ai: {
            connected: Boolean(data.ai?.connected),
            provider: data.ai?.provider ?? null,
            model: data.ai?.model ?? null,
          },
          naverSearch: {
            connected: Boolean(data.naverSearch?.connected),
          },
        });
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setState({
          ...initialState,
          status: 'error',
        });
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}
