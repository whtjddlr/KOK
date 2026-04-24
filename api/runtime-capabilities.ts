import { json, pickFirstEnv } from './_lib/server.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    json(res, 405, { message: 'Method not allowed' });
    return;
  }

  const env = process.env;
  const rawOpenAiKey = pickFirstEnv(env, ['OPENAI_API_KEY', 'AI_API_KEY', 'VITE_OPENAI_API_KEY']);
  const rawUpstageKey = pickFirstEnv(env, [
    'UPSTAGE_API_KEY',
    'SOLAR_API_KEY',
    'VITE_UPSTAGE_API_KEY',
  ]);
  const detectedUpstageKey =
    rawUpstageKey || (rawOpenAiKey.startsWith('up_') ? rawOpenAiKey : '');
  const detectedOpenAiKey =
    detectedUpstageKey && rawOpenAiKey === detectedUpstageKey ? '' : rawOpenAiKey;
  const aiProvider = detectedUpstageKey ? 'upstage' : detectedOpenAiKey ? 'openai' : null;
  const aiModel = detectedUpstageKey
    ? pickFirstEnv(env, ['UPSTAGE_MODEL', 'SOLAR_MODEL', 'VITE_UPSTAGE_MODEL']) || 'solar-pro3'
    : detectedOpenAiKey
      ? pickFirstEnv(env, ['OPENAI_MODEL', 'VITE_OPENAI_MODEL']) || 'gpt-4o-mini'
      : null;

  json(res, 200, {
    ai: {
      connected: Boolean(aiProvider),
      provider: aiProvider,
      model: aiModel,
    },
    naverSearch: {
      connected: Boolean(env.NAVER_SEARCH_CLIENT_ID && env.NAVER_SEARCH_CLIENT_SECRET),
    },
    odsayTransit: {
      connected: Boolean(pickFirstEnv(env, ['ODSAY_API_KEY', 'VITE_ODSAY_API_KEY'])),
    },
  });
}
