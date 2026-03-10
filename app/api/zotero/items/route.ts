import { NextRequest, NextResponse } from 'next/server'

const ZOTERO_API_BASE = 'https://api.zotero.org'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const apiKey = searchParams.get('apiKey')
    const limit = searchParams.get('limit') || '50'
    const start = searchParams.get('start') || '0'
    const collectionKey = searchParams.get('collectionKey')

    if (!userId || !apiKey) {
      return NextResponse.json({ error: 'Missing userId or apiKey' }, { status: 400 })
    }

    // 构建 API URL
    let apiUrl = `${ZOTERO_API_BASE}/users/${userId}/items`
    if (collectionKey) {
      apiUrl = `${ZOTERO_API_BASE}/users/${userId}/collections/${collectionKey}/items/top`
    } else {
      apiUrl += '/top'
    }

    const params = new URLSearchParams({
      v: '3',
      format: 'json',
      include: 'data,bib',
      limit,
      start,
      sort: 'dateModified',
      direction: 'desc',
    })

    const response = await fetch(`${apiUrl}?${params}`, {
      headers: {
        'Zotero-API-Key': apiKey,
        'Zotero-API-Version': '3',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('Zotero API error:', text)
      return NextResponse.json({ error: 'Failed to fetch items', details: text }, { status: response.status })
    }

    const data = await response.json()
    const totalResults = response.headers.get('Total-Results') || '0'

    // 获取每个条目的附件信息
    const itemsWithAttachments = await Promise.all(
      (data as Record<string, unknown>[]).map(async (item: Record<string, unknown>) => {
        const itemKey = item.key as string
        const dataField = (item.data as Record<string, unknown>) || {}
        
        // 获取该条目的子条目（附件）
        let hasAttachment = false
        let attachmentUrl = ''
        let attachmentFileName = ''
        
        try {
          const childrenRes = await fetch(
            `${ZOTERO_API_BASE}/users/${userId}/items/${itemKey}/children?v=3&format=json`,
            {
              headers: {
                'Zotero-API-Key': apiKey,
                'Zotero-API-Version': '3',
              },
            }
          )
          
          if (childrenRes.ok) {
            const children = await childrenRes.json() as Record<string, unknown>[]
            
            // 查找 PDF 附件
            const pdfAttachment = children.find((child: Record<string, unknown>) => {
              const childData = child.data as Record<string, unknown>
              return (
                childData.itemType === 'attachment' &&
                (childData.contentType === 'application/pdf' ||
                 childData.linkMode === 'imported_file' ||
                 childData.linkMode === 'imported_url')
              )
            })
            
            if (pdfAttachment) {
              hasAttachment = true
              const pdfData = pdfAttachment.data as Record<string, unknown>
              attachmentFileName = (pdfData.filename as string) || (pdfData.title as string) || ''
              
              // 构建附件下载 URL
              if (pdfData.key) {
                attachmentUrl = `${ZOTERO_API_BASE}/users/${userId}/items/${pdfData.key}/file?key=${apiKey}`
              }
            }
          }
        } catch (e) {
          console.error('Error fetching attachments for item:', itemKey, e)
        }

        return {
          key: itemKey,
          title: dataField.title || 'Untitled',
          authors: ((dataField.creators as Array<{firstName?: string; lastName?: string; name?: string}>) || [])
            .map(c => c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim())
            .filter(Boolean),
          abstract: dataField.abstractNote || '',
          year: dataField.date || '',
          journal: dataField.publicationTitle || dataField.journalAbbreviation || '',
          doi: dataField.DOI || '',
          url: dataField.url || '',
          tags: ((dataField.tags as Array<{tag: string}>) || []).map(t => t.tag),
          itemType: dataField.itemType || '',
          bib: item.bib || '',
          // 新增附件字段
          hasAttachment,
          attachmentUrl,
          attachmentFileName,
        }
      })
    )

    return NextResponse.json({
      items: itemsWithAttachments,
      total: parseInt(totalResults),
    })
  } catch (error) {
    console.error('Fetch Zotero items error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
