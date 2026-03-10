import { NextRequest, NextResponse } from 'next/server'

const ZOTERO_CLIENT_KEY = process.env.ZOTERO_CLIENT_KEY || 'f59fc5e5310bdd408690'
const ZOTERO_CLIENT_SECRET = process.env.ZOTERO_CLIENT_SECRET || '48f7854738856e103eab'
const ZOTERO_ACCESS_TOKEN_URL = 'https://www.zotero.org/oauth/access'

function generateNonce(length = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

async function generateSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string = ''
): Promise<string> {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')

  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(baseString))
  
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

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
    const oauthToken = searchParams.get('oauth_token')
    const oauthVerifier = searchParams.get('oauth_verifier')
    const tokenSecret = searchParams.get('token_secret') // 从状态中获取

    if (!oauthToken || !oauthVerifier) {
      return NextResponse.redirect(new URL('/settings?zotero=error', request.url))
    }

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = generateNonce()

    const params: Record<string, string> = {
      oauth_consumer_key: ZOTERO_CLIENT_KEY,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: oauthToken,
      oauth_verifier: oauthVerifier,
      oauth_version: '1.0',
    }

    const signature = await generateSignature(
      'POST',
      ZOTERO_ACCESS_TOKEN_URL,
      params,
      ZOTERO_CLIENT_SECRET,
      tokenSecret || ''
    )
    params.oauth_signature = signature

    const authHeader = 'OAuth ' + Object.keys(params)
      .map(key => `${encodeURIComponentStrict(key)}="${encodeURIComponentStrict(params[key])}"`)
      .join(', ')

    const response = await fetch(ZOTERO_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('Zotero access token failed:', text)
      return NextResponse.redirect(new URL('/settings?zotero=error', request.url))
    }

    const responseText = await response.text()
    const responseParams = new URLSearchParams(responseText)
    
    const accessToken = responseParams.get('oauth_token')
    const userID = responseParams.get('userID')

    if (!accessToken || !userID) {
      return NextResponse.redirect(new URL('/settings?zotero=error', request.url))
    }

    // 重定向到设置页面，携带 token 和 userID
    const redirectUrl = new URL('/settings', request.url)
    redirectUrl.searchParams.set('zotero', 'success')
    redirectUrl.searchParams.set('apiKey', accessToken)
    redirectUrl.searchParams.set('userId', userID)
    
    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    console.error('Zotero callback error:', error)
    return NextResponse.redirect(new URL('/settings?zotero=error', request.url))
  }
}
