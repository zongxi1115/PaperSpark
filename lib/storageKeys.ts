export const STORAGE_PREFIX = 'paper_reader_'

export const THEME_STORAGE_KEY = 'theme'
export const THEME_STORAGE_FULL_KEY = `${STORAGE_PREFIX}${THEME_STORAGE_KEY}`

export const PREVIEW_NOTICE_ACK_DATE_KEY = 'vercel_preview_notice_ack_date'
export const PREVIEW_NOTICE_ACK_DATE_FULL_KEY = `${STORAGE_PREFIX}${PREVIEW_NOTICE_ACK_DATE_KEY}`

export const LOCAL_STORAGE_ONLY_KEYS = new Set<string>([
  THEME_STORAGE_KEY,
  PREVIEW_NOTICE_ACK_DATE_KEY,
])
