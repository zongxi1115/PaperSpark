import { NextRequest, NextResponse } from 'next/server'

// Zotero OAuth 1.0a 配置
const ZOTERO_CLIENT_KEY = process.env.ZOTERO_CLIENT_KEY || 'f59fc5e5310bdd408690'
const ZOTERO_CLIENT_SECRET = process.env.ZOTERO_CLIENT_SECRET || '48f7854738856e103eab'
const ZOTERO_REQUEST_TOKEN_URL = 'https://www.zotero.org/oauth/request'
const ZOTERO_AUTHORIZE_URL = 'https://www.zotero.org/oauth/authorize'
const ZOTERO_ACCESS_TOKEN_URL = 'https://www.zotero.org/oauth/access'

// 生成随机字符串
function generateNonce(length = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// 生成 OAuth 1.0a 签名
async function generateSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string = ''
): Promise<string> {
  // 对参数排序并编码
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')

  // 创建签名字符串
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`

  // 创建签名密钥
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`

  // 使用 HMAC-SHA1 生成签名
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(baseString))
  
  // Base64 编码
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

// URL 编码函数
function encodeURIComponentStrict(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const callbackUrl = searchParams.get('callback') || `${request.nextUrl.origin}/api/zotero/callback`

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = generateNonce()

    // 请求令牌参数
    const params: Record<string, string> = {
      oauth_consumer_key: ZOTERO_CLIENT_KEY,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_version: '1.0',
      oauth_callback: callbackUrl,
    }

    // 生成签名
    const signature = await generateSignature(
      'POST',
      ZOTERO_REQUEST_TOKEN_URL,
      params,
      ZOTERO_CLIENT_SECRET
    )
    params.oauth_signature = signature

    // 构建授权头
    const authHeader = 'OAuth ' + Object.keys(params)
      .map(key => `${encodeURIComponentStrict(key)}="${encodeURIComponentStrict(params[key])}"`)
      .join(', ')

    // 请求临时令牌
    const response = await fetch(ZOTERO_REQUEST_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('Zotero request token failed:', text)
      return NextResponse.json({ error: 'Failed to get request token', details: text }, { status: 400 })
    }

    const responseText = await response.text()
    const responseParams = new URLSearchParams(responseText)
    
    const oauthToken = responseParams.get('oauth_token')
    const oauthTokenSecret = responseParams.get('oauth_token_secret')

    if (!oauthToken || !oauthTokenSecret) {
      return NextResponse.json({ error: 'Invalid response from Zotero' }, { status: 400 })
    }

    // 构建授权 URL
    const authorizeUrl = `${ZOTERO_AUTHORIZE_URL}?oauth_token=${encodeURIComponent(oauthToken)}&oauth_callback=${encodeURIComponent(callbackUrl)}`

    return NextResponse.json({
      authorizeUrl,
      oauthToken,
      oauthTokenSecret, // 客户端需要临时存储这个
    })
  } catch (error) {
    console.error('Zotero auth error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
