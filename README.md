# Hermes Docs MCP

MCP server that gives AI agents searchable access to the Hermes Agent documentation.
It uses a local Hermes checkout when available, so documentation can match the
installed version and be searched offline, with a GitHub fallback otherwise.

## Tools

- `search_hermes_docs(query, limit)`: search indexed pages by title, slug, headings,
  environment variables, and content.
- `get_hermes_doc(slug)`: retrieve a full page as compact Markdown. Accepts bare
  slugs and full documentation URLs.
- `list_hermes_docs(section?, limit)`: list indexed pages, optionally filtered by section.

## Installation

Requires Node.js 20 or later and npm. Clone this repository, open its directory,
and run:

```bash
npm ci
npm test
npm run build
```

Run the server with `npm start`, or configure an MCP client to launch
`node /absolute/path/to/hermes-docs-mcp/dist/cli.js` over standard input and output.
The package is private in npm metadata; these instructions use a source checkout,
not an npm registry installation.

## Documentation source

By default, the server checks `~/.hermes/hermes-agent/website/docs`. When that
local checkout exists, its documentation reflects that checkout's version. Search
and list results include the local Git commit when available, or `unknown` otherwise.
The local index refreshes after a short cache interval when another request arrives.

Without the default local directory, the server fetches documentation from the
`main` branch of `NousResearch/hermes-agent` on GitHub. This requires network access
and may describe a different version than your installed Hermes Agent.

To explicitly select a local documentation directory:

```bash
HERMES_DOCS_DIR=/path/to/hermes-agent/website/docs npm start
```

An explicit directory must exist; it does not fall back to GitHub on error.

## Hermes configuration example

Add the following entry to your Hermes configuration file, adjusting the absolute
path to your checkout. Configuration is not installed automatically.

```yaml
mcp_servers:
  hermes-docs:
    command: "node"
    args: ["/absolute/path/to/hermes-docs-mcp/dist/cli.js"]
    timeout: 180
    connect_timeout: 60
    enabled: true
```

If your client cannot find `node`, use the absolute path to your Node.js executable.
