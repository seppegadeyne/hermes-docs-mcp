import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatDoc, getLocalDocsCommit, loadDocs, searchDocs } from './docs.js';

const packageJson = JSON.parse(
  await readFile(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'),
) as { version: string };

const readOnlyAnnotations = {
  title: 'Hermes Agent docs',
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function createServer() {
  const server = new McpServer(
    {
      name: 'hermes-docs',
      version: packageJson.version,
    },
    {
      instructions: [
        'Use this server to answer questions about Hermes Agent (the Nous Research AI agent) configuration and features.',
        'Docs are indexed from the local install (~/.hermes/hermes-agent/website/docs) so answers match the installed version.',
        'Prefer search_hermes_docs first when you do not know the exact slug.',
        'Use get_hermes_doc for the full canonical page content.',
      ].join('\n'),
    },
  );

  server.registerTool(
    'search_hermes_docs',
    {
      title: 'Search Hermes Agent docs',
      description:
        'Search the Hermes Agent documentation (configuration, features, CLI, gateway, providers, reference). Matches titles, slugs, headings, env vars, and content.',
      annotations: readOnlyAnnotations,
      inputSchema: {
        query: z
          .string()
          .describe("Search terms, e.g. 'mcp_servers config', 'OPENROUTER_API_KEY', or 'cron delivery'"),
        limit: z.number().int().min(1).max(20).default(10).describe('Maximum number of results to return'),
      },
    },
    async ({ query, limit }) => {
      const docs = await loadDocs();
      const results = searchDocs(docs, query, limit);
      const commit = await getLocalDocsCommit();
      const text =
        results.length === 0
          ? `No Hermes Agent documentation results found for "${query}" (indexed commit ${commit}).`
          : [
              `Hermes Agent docs (${docs.length} pages, installed commit ${commit}):`,
              '',
              ...results.map((result, index) => {
                const headings =
                  result.headings.length > 0 ? `\nheadings: ${result.headings.slice(0, 6).join(' > ')}` : '';
                return `${index + 1}. ${result.title}\nslug: \`${result.slug}\`\nsection: ${result.section}\nurl: ${result.url}\ndescription: ${result.description}\nsnippet: ${result.snippet}${headings}`;
              }),
            ].join('\n');

      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'get_hermes_doc',
    {
      title: 'Get Hermes Agent doc',
      description:
        'Retrieve one Hermes Agent documentation page by slug (e.g. user-guide/features/mcp) as compact markdown. Accepts bare slugs and full docs URLs.',
      annotations: readOnlyAnnotations,
      inputSchema: {
        slug: z
          .string()
          .describe("Documentation slug, e.g. 'user-guide/features/mcp', 'reference/environment-variables', or a full /docs/ URL"),
      },
    },
    async ({ slug }) => {
      const docs = await loadDocs();
      const normalizedSlug = slug
        .replace(/^https:\/\/hermes-agent\.nousresearch\.com\/docs\/?/, '')
        .replace(/^\/docs\/?/, '')
        .replace(/\/$/, '');
      const doc = docs.find((entry) => entry.slug === normalizedSlug);

      if (!doc) {
        const suggestions = searchDocs(docs, normalizedSlug.replace(/[/\-_]/g, ' '), 5)
          .map((entry) => `- ${entry.title} (slug: \`${entry.slug}\`)`)
          .join('\n');
        return {
          content: [
            {
              type: 'text',
              text: `No Hermes Agent doc found for slug \`${slug}\`.${suggestions ? `\n\nClosest matches:\n${suggestions}` : ''}`,
            },
          ],
          isError: true,
        };
      }

      return { content: [{ type: 'text', text: formatDoc(doc) }] };
    },
  );

  server.registerTool(
    'list_hermes_docs',
    {
      title: 'List Hermes Agent docs',
      description:
        'List indexed Hermes Agent documentation pages grouped by section, with slugs and descriptions. Optional section filter (e.g. user-guide, reference).',
      annotations: readOnlyAnnotations,
      inputSchema: {
        section: z
          .string()
          .optional()
          .describe('Only list docs from this top-level section, e.g. user-guide, reference, developer-guide'),
        limit: z.number().int().min(1).max(500).default(500).describe('Maximum number of docs to list'),
      },
    },
    async ({ section, limit }) => {
      const docs = await loadDocs();
      const commit = await getLocalDocsCommit();
      const filtered = section
        ? docs.filter((doc) => doc.section === section.toLowerCase())
        : docs;
      const listed = filtered.slice(0, limit);

      if (listed.length === 0) {
        const sections = [...new Set(docs.map((doc) => doc.section))].join(', ');
        return {
          content: [
            {
              type: 'text',
              text: `No docs found for section "${section}". Available sections: ${sections}`,
            },
          ],
        };
      }

      const text = [
        `Hermes Agent docs: ${listed.length} of ${docs.length} pages (installed commit ${commit}).`,
        '',
        ...listed.map((doc) => `- ${doc.title} — \`${doc.slug}\` — ${doc.description}`),
      ].join('\n');

      return { content: [{ type: 'text', text }] };
    },
  );

  return server;
}
