export type CitationLinkType =
  | 'doi'
  | 'url'
  | 'arxiv'
  | 'pubmed'
  | 'pmc'
  | 'isbn'
  | 'scholar-search'
  | 'crossref-search'
  | 'openalex-search'

export type CitationLinkConfidence = 'high' | 'medium' | 'low'

export interface CitationLink {
  type: CitationLinkType
  label: string
  url: string
  confidence: CitationLinkConfidence
  source: 'identifier' | 'embedded-url' | 'title-search' | 'citation-search'
}

export interface CitationLinkOptions {
  includeSearchLinks?: boolean
  maxLinks?: number
}

const DOI_PATTERN = /\b(10\.\d{4,9}\/[\w.()/:;+-]+)\b/ig
const URL_PATTERN = /https?:\/\/[^\s<>")\]]+/ig
const ARXIV_PATTERN = /\barXiv:\s*([a-z\-.]+\/\d{7}|\d{4}\.\d{4,5}(?:v\d+)?)\b/i
const PMID_PATTERN = /\bPMID:\s*(\d{5,10})\b/i
const PMCID_PATTERN = /\bPMCID:\s*(PMC\d+)\b/i
const ISBN_PATTERN = /\bISBN(?:-1[03])?:?\s*((?:97[89][\d-]{10,17})|(?:[\d-]{9,17}[\dXx]))\b/i
const QUOTED_TITLE_PATTERNS = [
  /“([^”]{6,})”/,
  /"([^"]{6,})"/,
  /'([^']{6,})'/,
  /《([^》]{4,})》/,
]

function normalizeCitationText(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
}

function stripTrailingLinkPunctuation(value: string) {
  return value.replace(/[),.;\]]+$/, '')
}

function normalizeIsbn(value: string) {
  return value.replace(/[^0-9Xx]/g, '').toUpperCase()
}

function buildUrl(baseUrl: string, query: string) {
  return `${baseUrl}${encodeURIComponent(query)}`
}

function pushUniqueLink(target: CitationLink[], nextLink: CitationLink) {
  const normalizedUrl = stripTrailingLinkPunctuation(nextLink.url)
  if (!normalizedUrl) return
  if (target.some(item => item.url === normalizedUrl)) return
  target.push({ ...nextLink, url: normalizedUrl })
}

function extractTitleCandidate(citation: string) {
  for (const pattern of QUOTED_TITLE_PATTERNS) {
    const match = citation.match(pattern)
    if (match?.[1]) {
      return normalizeCitationText(match[1])
    }
  }

  const normalized = normalizeCitationText(citation)
  if (!normalized) return ''

  const withoutLeadingIndex = normalized.replace(/^\[\d+\]\s*/, '')
  const sentences = withoutLeadingIndex
    .split(/(?<=[.!?])\s+/)
    .map(part => part.trim())
    .filter(Boolean)

  const titleLikeSentence = sentences.find((sentence) => {
    if (sentence.length < 12 || sentence.length > 240) return false
    if (/^(https?:\/\/|doi:|pmid:|pmcid:|isbn:)/i.test(sentence)) return false
    if (/^[A-Z][a-z]+,\s+[A-Z]/.test(sentence)) return false
    return /[A-Za-z\u3400-\u9fff]/.test(sentence)
  })

  return titleLikeSentence ? normalizeCitationText(titleLikeSentence) : ''
}

export function extractCitationLinks(
  citation: string,
  options: CitationLinkOptions = {},
) {
  const normalized = normalizeCitationText(citation)
  if (!normalized) return [] as CitationLink[]

  const includeSearchLinks = options.includeSearchLinks ?? true
  const maxLinks = options.maxLinks ?? 8
  const links: CitationLink[] = []

  const doiMatches = Array.from(normalized.matchAll(DOI_PATTERN))
    .map(match => stripTrailingLinkPunctuation(match[1]))
    .filter(Boolean)
  doiMatches.forEach((doi) => {
    pushUniqueLink(links, {
      type: 'doi',
      label: 'DOI',
      url: `https://doi.org/${doi}`,
      confidence: 'high',
      source: 'identifier',
    })
  })

  const urlMatches = Array.from(normalized.matchAll(URL_PATTERN))
    .map(match => stripTrailingLinkPunctuation(match[0]))
    .filter(Boolean)
  urlMatches.forEach((url) => {
    pushUniqueLink(links, {
      type: /doi\.org\//i.test(url) ? 'doi' : 'url',
      label: /doi\.org\//i.test(url) ? 'DOI' : 'Link',
      url,
      confidence: 'high',
      source: 'embedded-url',
    })
  })

  const arxivMatch = normalized.match(ARXIV_PATTERN)
  if (arxivMatch?.[1]) {
    pushUniqueLink(links, {
      type: 'arxiv',
      label: 'arXiv',
      url: `https://arxiv.org/abs/${arxivMatch[1]}`,
      confidence: 'high',
      source: 'identifier',
    })
  }

  const pmidMatch = normalized.match(PMID_PATTERN)
  if (pmidMatch?.[1]) {
    pushUniqueLink(links, {
      type: 'pubmed',
      label: 'PubMed',
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmidMatch[1]}/`,
      confidence: 'high',
      source: 'identifier',
    })
  }

  const pmcidMatch = normalized.match(PMCID_PATTERN)
  if (pmcidMatch?.[1]) {
    pushUniqueLink(links, {
      type: 'pmc',
      label: 'PMC',
      url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcidMatch[1].toUpperCase()}/`,
      confidence: 'high',
      source: 'identifier',
    })
  }

  const isbnMatch = normalized.match(ISBN_PATTERN)
  if (isbnMatch?.[1]) {
    const isbn = normalizeIsbn(isbnMatch[1])
    if (isbn) {
      pushUniqueLink(links, {
        type: 'isbn',
        label: 'Google Books',
        url: `https://books.google.com/books?vid=ISBN${isbn}`,
        confidence: 'medium',
        source: 'identifier',
      })
    }
  }

  if (!includeSearchLinks) {
    return links.slice(0, maxLinks)
  }

  const titleCandidate = extractTitleCandidate(normalized)
  const searchQuery = titleCandidate || normalized

  if (searchQuery) {
    pushUniqueLink(links, {
      type: 'scholar-search',
      label: 'Google Scholar',
      url: buildUrl('https://scholar.google.com/scholar?q=', searchQuery),
      confidence: titleCandidate ? 'medium' : 'low',
      source: titleCandidate ? 'title-search' : 'citation-search',
    })

    pushUniqueLink(links, {
      type: 'crossref-search',
      label: 'Crossref Search',
      url: buildUrl('https://search.crossref.org/?q=', searchQuery),
      confidence: titleCandidate ? 'medium' : 'low',
      source: titleCandidate ? 'title-search' : 'citation-search',
    })

    pushUniqueLink(links, {
      type: 'openalex-search',
      label: 'OpenAlex Search',
      url: buildUrl('https://openalex.org/works?search=', searchQuery),
      confidence: titleCandidate ? 'medium' : 'low',
      source: titleCandidate ? 'title-search' : 'citation-search',
    })
  }

  return links.slice(0, maxLinks)
}

export function getBestCitationLink(citation: string, options?: CitationLinkOptions) {
  return extractCitationLinks(citation, options)[0] || null
}
