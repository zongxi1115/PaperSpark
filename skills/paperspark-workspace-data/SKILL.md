---
name: paperspark-workspace-data
description: Access and inspect saved PaperSpark workspace data, including knowledge base entries, immersive-reading full text, guide summaries, assets, thoughts, assistant conversations, and document versions. Use when asked to answer questions from the user's local PaperSpark data, list saved materials, fetch article full text or summaries, or query PaperSpark workspace content through the local service or snapshot bridge.
---

# PaperSpark Workspace Data

## Overview

Use the PaperSpark data bridge instead of scraping repo files or guessing browser storage. Prefer the local service bridge first, then fall back to the local snapshot file if the service is unavailable.

## Query Workflow

1. Check whether the local service bridge is available.

```powershell
.\paperspark-data.ps1 summary --server http://127.0.0.1:3000
```

If the command returns a 404-style error about missing synced data, tell the user to open PaperSpark settings and click `Sync to Local Service`.

2. Fall back to the local snapshot when the service is unavailable.

```powershell
.\paperspark-data.ps1 summary
```

The CLI will automatically look in:

- `out/workspace-cli/paperspark-workspace-snapshot.json`
- `out/paperspark-workspace-snapshot.json`
- `paperspark-workspace-snapshot.json`

3. Discover the right records before reading large payloads.

```powershell
.\paperspark-data.ps1 list knowledge --server http://127.0.0.1:3000
.\paperspark-data.ps1 list assets --server http://127.0.0.1:3000
.\paperspark-data.ps1 list documents --server http://127.0.0.1:3000
```

4. Read a specific record once you know its id.

```powershell
.\paperspark-data.ps1 get knowledge <knowledgeId> --server http://127.0.0.1:3000
.\paperspark-data.ps1 get assets <assetId> --server http://127.0.0.1:3000
```

5. Pull raw full text or other nested fields with `--field` and `--raw`.

```powershell
.\paperspark-data.ps1 get knowledge <knowledgeId> --field immersive.fullText --raw --server http://127.0.0.1:3000
.\paperspark-data.ps1 get knowledge <knowledgeId> --field immersive.guide.summary --server http://127.0.0.1:3000
.\paperspark-data.ps1 get documents <documentId> --field plainText --raw --server http://127.0.0.1:3000
```

6. Use full-text search when the user does not know exact ids.

```powershell
.\paperspark-data.ps1 search "transformer" --server http://127.0.0.1:3000
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

- If `--server` fails because the service is down, fall back to local snapshot mode.
- If both service and snapshot mode fail, tell the user that the PaperSpark bridge has not been synced or exported yet.
- If the user wants zero manual sync steps, explain that the current project still stores source data in browser-local storage, so a future refactor would need to move persistence to a true server-side store.
