import { getServerAiProviders, json, pickFirstEnv } from './_lib/server.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    json(res, 405, { message: 'Method not allowed' });
    return;
  }

  const env = process.env;
  const [serverAiProvider] = getServerAiProviders(env, null);

  json(res, 200, {
    ai: {
      connected: Boolean(serverAiProvider),
      provider: serverAiProvider?.provider ?? null,
      model: serverAiProvider?.model ?? null,
    },
    naverSearch: {
      connected: Boolean(env.NAVER_SEARCH_CLIENT_ID && env.NAVER_SEARCH_CLIENT_SECRET),
    },
    odsayTransit: {
      connected: Boolean(pickFirstEnv(env, ['ODSAY_API_KEY', 'VITE_ODSAY_API_KEY'])),
    },
  });
}
