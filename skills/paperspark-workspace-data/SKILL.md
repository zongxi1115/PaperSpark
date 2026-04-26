---
name: paperspark-workspace-data
description: Access and inspect live PaperSpark workspace data, including knowledge base entries, immersive-reading full text, guide summaries, assets, thoughts, assistant conversations, and document versions. Use when asked to answer questions from the user's local PaperSpark data, list saved materials, fetch article full text or summaries, or query PaperSpark workspace content through the local service bridge.
---

# PaperSpark Workspace Data

## Overview

Use the PaperSpark local service bridge instead of scraping repo files or guessing browser storage. The app now auto-bridges browser data to the local Next service while the page is open, and the CLI should query the HTTP API by default.

## Query Workflow

1. Check whether the local service bridge is available.

```powershell
.\paperspark-data.ps1 summary
```

If the command says the bridge has no data yet, tell the user to keep the PaperSpark page open for a few seconds. If needed, ask them to open Settings and click `立即同步`.

2. Discover the right records before reading large payloads.

```powershell
.\paperspark-data.ps1 list knowledge
.\paperspark-data.ps1 list assets
.\paperspark-data.ps1 list documents
```

3. Read a specific record once you know its id.

```powershell
.\paperspark-data.ps1 get knowledge <knowledgeId>
.\paperspark-data.ps1 get assets <assetId>
```

4. Pull raw full text or other nested fields with `--field` and `--raw`.

```powershell
.\paperspark-data.ps1 get knowledge <knowledgeId> --field immersive.fullText --raw
.\paperspark-data.ps1 get knowledge <knowledgeId> --field immersive.guide.summary
.\paperspark-data.ps1 get documents <documentId> --field plainText --raw
```

5. Use full-text search when the user does not know exact ids.

```powershell
.\paperspark-data.ps1 search "transformer"
```

## High-Value Sections

- `knowledge`: metadata, overview text, immersive full text, translation cache, guide cache, annotations, local file metadata
- `assets`: asset content plus extracted plain text and preview text
- `documents`: editor documents plus extracted plain text
- `documentVersions`: saved historical snapshots of documents
- `thoughts`: thought records plus extracted plain text
- `conversations`: assistant conversations and messages
- `assistantNotes`: assistant scratch notes
- `knowledgeGraph`: saved graph nodes and edges

## Response Strategy

- Start with `summary` or `list` when you need orientation.
- Use `search` when the user describes content but not ids.
- Use `get ... --field immersive.fullText --raw` when the user asks for the full paper text.
- Use `get` without `--field` when you need metadata, summaries, annotations, or guide data together.
- Cite the ids you used in your final answer when multiple similarly named records exist.

## Failure Recovery

- If the local service is down, tell the user to start PaperSpark with `pnpm dev` or `pnpm start`.
- If the service is up but reports no bridged data yet, tell the user to open PaperSpark and wait a few seconds for auto-sync, or click `立即同步` in Settings.
- Only use `--snapshot` when the user explicitly wants an offline JSON backup path. Do not lead with snapshot mode.
- If the user asks why this bridge exists at all, explain briefly that the source data still lives in browser-local storage and IndexedDB, so the CLI needs the running app to relay that data into an HTTP-accessible local bridge.
