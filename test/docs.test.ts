import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  buildIndexFromDirectory,
  formatDoc,
  parseMarkdownDoc,
  searchDocs,
} from '../src/docs.ts';

let fixtureDir: string;

const makeFixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hermes-docs-test-'));
  mkdirSync(path.join(dir, 'user-guide', 'features'), { recursive: true });
  mkdirSync(path.join(dir, 'reference'), { recursive: true });

  writeFileSync(
    path.join(dir, 'user-guide', 'features', 'mcp.md'),
    `---
sidebar_position: 4
title: "MCP (Model Context Protocol)"
description: "Connect Hermes Agent to external tool servers via MCP"
---

# MCP (Model Context Protocol)

MCP lets Hermes connect to external tool servers.

## Configuring servers

Add servers under \`mcp_servers\` in config.yaml.

:::tip
Use \`hermes mcp test\` to verify a server.
:::

\`\`\`yaml
mcp_servers:
  github:
    command: npx
\`\`\`

### Tool filtering

Include lists restrict tools.
`,
  );

  writeFileSync(
    path.join(dir, 'reference', 'environment-variables.md'),
    `---
title: Environment Variables
description: "All env vars Hermes reads, like OPENROUTER_API_KEY"
---

# Environment Variables

Provider keys such as \`OPENROUTER_API_KEY\` and \`GLM_API_KEY\`.

## Memory
\`HERMES_HOME\` overrides the config directory.
`,
  );

  writeFileSync(
    path.join(dir, 'user-guide', 'features', 'index.md'),
    `---
title: Features
description: "Explore the powerful features of Hermes Agent."
---

Browse all features here.
`,
  );

  return dir;
};

beforeEach(() => {
  fixtureDir = makeFixture();
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('parseMarkdownDoc', () => {
  it('extracts frontmatter title and description', () => {
    const doc = parseMarkdownDoc('user-guide/features/mcp.md', `---
title: "MCP (Model Context Protocol)"
description: "Connect Hermes Agent"
---

# Body
`);
    assert.equal(doc.title, 'MCP (Model Context Protocol)');
    assert.equal(doc.description, 'Connect Hermes Agent');
  });

  it('falls back to first heading when no title in frontmatter', () => {
    const doc = parseMarkdownDoc('reference/no-title.md', `---
description: "Something"
---

# Implicit Title From Heading

Body.
`);
    assert.equal(doc.title, 'Implicit Title From Heading');
  });

  it('builds a url-safe slug from the source path', () => {
    const doc = parseMarkdownDoc('user-guide/features/mcp.md', '# X\n');
    assert.equal(doc.slug, 'user-guide/features/mcp');
    assert.equal(doc.url, 'https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp');
  });

  it('normalizes the root index slug', () => {
    const doc = parseMarkdownDoc(
      'index.mdx',
      `---
slug: /
title: Root
---

Body
`,
    );
    assert.equal(doc.slug, 'index');
  });

  it('strips index suffix from slug for section pages', () => {
    const doc = parseMarkdownDoc('user-guide/features/index.md', '# Features\n');
    assert.equal(doc.slug, 'user-guide/features');
  });

  it('keeps headings but excludes the h1 duplicate and code fences', () => {
    const doc = parseMarkdownDoc(
      'a.md',
      `---
title: T
---

# T

## Real Section

\`\`\`bash
## not a heading
\`\`\`

### Deeper
`,
    );
    assert.deepEqual(doc.headings, ['Real Section', 'Deeper']);
  });

  it('normalizes Docusaurus admonitions to plain markers', () => {
    const doc = parseMarkdownDoc(
      'a.md',
      `---
title: T
---

:::warning Tokens
Keep secrets safe.
:::
`,
    );
    assert.ok(doc.content.includes('[!WARNING]'), doc.content);
    assert.ok(!doc.content.includes(':::'));
  });

  it('leaves fenced code blocks untouched', () => {
    const doc = parseMarkdownDoc(
      'a.md',
      `---
title: T
---

\`\`\`python
import os
if True:
    pass
\`\`\`
`,
    );
    assert.ok(doc.content.includes('import os'));
    assert.ok(doc.content.includes('if True:'));
  });
});

describe('buildIndexFromDirectory', () => {
  it('indexes all markdown files recursively with slugs and section labels', async () => {
    const docs = await buildIndexFromDirectory(fixtureDir);
    const slugs = docs.map((d) => d.slug).sort();
    assert.deepEqual(slugs, [
      'reference/environment-variables',
      'user-guide/features',
      'user-guide/features/mcp',
    ]);
    const mcp = docs.find((d) => d.slug === 'user-guide/features/mcp')!;
    assert.equal(mcp.section, 'user-guide');
  });

  it('includes normalized content without frontmatter', async () => {
    const docs = await buildIndexFromDirectory(fixtureDir);
    const mcp = docs.find((d) => d.slug === 'user-guide/features/mcp')!;
    assert.ok(!mcp.content.includes('sidebar_position'));
    assert.ok(mcp.content.includes('Tool filtering'));
  });
});

describe('searchDocs', () => {
  it('ranks an exact title match first', async () => {
    const docs = await buildIndexFromDirectory(fixtureDir);
    const results = searchDocs(docs, 'MCP model context protocol', 5);
    assert.ok(results.length >= 1);
    assert.equal(results[0].slug, 'user-guide/features/mcp');
  });

  it('matches env var names in content', async () => {
    const docs = await buildIndexFromDirectory(fixtureDir);
    const results = searchDocs(docs, 'OPENROUTER_API_KEY', 5);
    assert.equal(results[0].slug, 'reference/environment-variables');
  });

  it('returns a snippet around the first matching term', async () => {
    const docs = await buildIndexFromDirectory(fixtureDir);
    const [result] = searchDocs(docs, 'OPENROUTER_API_KEY', 5);
    assert.ok(result.snippet.length > 0);
    assert.ok(result.snippet.toLowerCase().includes('openrouter_api_key'));
  });

  it('returns empty for a query without known terms', async () => {
    const docs = await buildIndexFromDirectory(fixtureDir);
    assert.deepEqual(searchDocs(docs, 'zzzzqqqq', 5), []);
  });
});

describe('formatDoc', () => {
  it('renders title, url, slug and content', async () => {
    const docs = await buildIndexFromDirectory(fixtureDir);
    const mcp = docs.find((d) => d.slug === 'user-guide/features/mcp')!;
    const text = formatDoc(mcp);
    assert.ok(text.includes('# MCP (Model Context Protocol)'));
    assert.ok(text.includes('URL: https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp'));
    assert.ok(text.includes('Slug: user-guide/features/mcp'));
    assert.ok(text.includes('## Configuring servers'));
  });
});
