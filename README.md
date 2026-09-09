# hermes-docs-mcp

Local MCP server that indexes the Hermes Agent documentation from the local
install (`~/.hermes/hermes-agent/website/docs`) so every agent on this machine
can consult docs that match the *installed* version — offline, with fast
search.

## Tools

- `search_hermes_docs(query, limit)` — ranked search over all ~435 doc pages
- `get_hermes_doc(slug)` — full page as compact markdown (accepts bare slugs
  and full /docs/ URLs)
- `list_hermes_docs(section?, limit)` — list indexed pages per section

## Why local

The docs in `website/docs/` belong to the exact git commit installed under
`~/.hermes/hermes-agent/`, and `hermes update` refreshes them automatically.
Search results include the installed commit so agents know which version the
docs describe. Falls back to GitHub (NousResearch/hermes-agent main) when no
local checkout exists.

## Development

```bash
npm install
npm test        # node:test + tsx
npm run build   # tsc -> dist/
```

Override the docs source with `HERMES_DOCS_DIR=/path/to/docs`.

Registered in `~/.hermes/config.yaml` and every profile config as
`mcp_servers.hermes-docs` (stdio, node dist/cli.js).
