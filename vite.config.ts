import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

function naverDirectionsProxy(clientId?: string, clientSecret?: string) {
  const middleware = async (req, res, next) => {
    if (!req.url?.startsWith('/api/naver/directions')) {
      next()
      return
    }

    if (req.method !== 'GET') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ message: 'Method not allowed' }))
      return
    }

    if (!clientId || !clientSecret) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          message: 'NAVER Maps Directions credentials are missing on the dev server.',
        }),
      )
      return
    }

    try {
      const requestUrl = new URL(req.url, 'http://127.0.0.1')
      const start = requestUrl.searchParams.get('start')
      const goal = requestUrl.searchParams.get('goal')
      const option = requestUrl.searchParams.get('option') ?? 'traoptimal'

      if (!start || !goal) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ message: 'start and goal query params are required.' }))
        return
      }

      const upstreamUrl = new URL('https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving')
      upstreamUrl.searchParams.set('start', start)
      upstreamUrl.searchParams.set('goal', goal)
      upstreamUrl.searchParams.set('option', option)

      const upstreamResponse = await fetch(upstreamUrl.toString(), {
        headers: {
          'x-ncp-apigw-api-key-id': clientId,
          'x-ncp-apigw-api-key': clientSecret,
          Accept: 'application/json',
        },
      })
      const body = await upstreamResponse.text()

      res.statusCode = upstreamResponse.status
      res.setHeader(
        'Content-Type',
        upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8',
      )
      res.end(body)
    } catch (error) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          message:
            error instanceof Error
              ? error.message
              : 'Unknown proxy error while calling NAVER Directions API.',
        }),
      )
    }
  }

  return {
    name: 'naver-directions-proxy',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      figmaAssetResolver(),
      naverDirectionsProxy(env.VITE_NAVER_MAP_KEY_ID, env.NAVER_MAP_CLIENT_SECRET),
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used – do not remove them
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        // Alias @ to the src directory
        '@': path.resolve(__dirname, './src'),
      },
    },

    // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
    assetsInclude: ['**/*.svg', '**/*.csv'],
  }
})
