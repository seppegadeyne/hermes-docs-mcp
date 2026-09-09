import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERMES_DOCS_BASE_URL = 'https://hermes-agent.nousresearch.com/docs';
const GITHUB_API_TREE_URL =
  'https://api.github.com/repos/NousResearch/hermes-agent/git/trees/main?recursive=1';
const RAW_DOCS_BASE_URL =
  'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs';
const DEFAULT_LOCAL_DOCS_DIR = path.join(homedir(), '.hermes', 'hermes-agent', 'website', 'docs');

export type HermesDoc = {
  slug: string;
  title: string;
  description: string;
  url: string;
  section: string;
  headings: string[];
  content: string;
  sourcePath: string;
};

export type SearchResult = Pick<HermesDoc, 'slug' | 'title' | 'description' | 'url' | 'section' | 'headings'> & {
  score: number;
  snippet: string;
};

type GitHubTreeResponse = {
  tree: Array<{ path: string; type: string }>;
};

let directoryCache: { docs: HermesDoc[]; loadedAt: number } | undefined;
let remoteCache: HermesDoc[] | undefined;

const CACHE_TTL_MS = 60_000;

export async function loadDocs(): Promise<HermesDoc[]> {
  const docsDir = process.env.HERMES_DOCS_DIR ?? DEFAULT_LOCAL_DOCS_DIR;

  if (process.env.HERMES_DOCS_DIR || (await dirExists(docsDir))) {
    if (
      directoryCache &&
      directoryCache.docs.length > 0 &&
      Date.now() - directoryCache.loadedAt < CACHE_TTL_MS
    ) {
      return directoryCache.docs;
    }
    const docs = await buildIndexFromDirectory(docsDir);
    directoryCache = { docs, loadedAt: Date.now() };
    return docs;
  }

  if (!remoteCache) {
    remoteCache = await buildIndexFromGitHub();
  }
  return remoteCache;
}

/** Short commit of the local hermes-agent checkout the docs were indexed from, or 'unknown'. */
export async function getLocalDocsCommit(): Promise<string> {
  const docsDir = process.env.HERMES_DOCS_DIR ?? DEFAULT_LOCAL_DOCS_DIR;
  const repoDir = path.dirname(path.dirname(docsDir)); // website/docs -> repo root
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'rev-parse', '--short', 'HEAD'], {
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function dirExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

export async function buildIndexFromDirectory(directory: string): Promise<HermesDoc[]> {
  const files = await listMarkdownFiles(directory, directory);
  files.sort();

  const docs = await Promise.all(
    files.map(async (relativePath) => {
      const filePath = path.join(directory, relativePath);
      return parseMarkdownDoc(relativePath, await readFile(filePath, 'utf8'));
    }),
  );

  return docs.filter((doc) => doc.title || doc.description || doc.content.trim());
}

async function listMarkdownFiles(root: string, current: string): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(root, entryPath)));
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
      files.push(path.relative(root, entryPath));
    }
  }

  return files;
}

export async function buildIndexFromGitHub(fetchImpl: typeof fetch = fetch): Promise<HermesDoc[]> {
  const treeResponse = await fetchImpl(GITHUB_API_TREE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'voltti-hermes-docs-mcp',
    },
  });

  if (!treeResponse.ok) {
    throw new Error(`Failed to list Hermes docs from GitHub: ${treeResponse.status} ${treeResponse.statusText}`);
  }

  const tree = (await treeResponse.json()) as GitHubTreeResponse;
  const docPaths = tree.tree
    .filter(
      (entry) =>
        entry.type === 'blob' &&
        entry.path.startsWith('website/docs/') &&
        (entry.path.endsWith('.md') || entry.path.endsWith('.mdx')),
    )
    .map((entry) => entry.path)
    .sort();

  const docs = await Promise.all(
    docPaths.map(async (docPath) => {
      const relativePath = docPath.slice('website/docs/'.length);
      const rawResponse = await fetchImpl(`${RAW_DOCS_BASE_URL}/${relativePath}`, {
        headers: { 'User-Agent': 'voltti-hermes-docs-mcp' },
      });

      if (!rawResponse.ok) {
        throw new Error(`Failed to fetch ${docPath}: ${rawResponse.status} ${rawResponse.statusText}`);
      }

      return parseMarkdownDoc(relativePath, await rawResponse.text(), docPath);
    }),
  );

  return docs;
}

export function parseMarkdownDoc(
  sourcePath: string,
  markdown: string,
  remoteSourcePath?: string,
): HermesDoc {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const title =
    extractFrontmatterString(frontmatter, 'title') ?? firstHeading(body) ?? sourcePath;
  const description = extractFrontmatterString(frontmatter, 'description') ?? '';

  return {
    slug: slugFromSourcePath(sourcePath),
    title,
    description,
    url: docUrl(slugFromSourcePath(sourcePath)),
    section: sourcePath.includes('/') ? sourcePath.split('/')[0] : 'docs',
    headings: extractHeadings(body),
    content: normalizeContent(body),
    sourcePath: remoteSourcePath ?? sourcePath,
  };
}

function docUrl(slug: string): string {
  if (slug === 'index') {
    return 'https://hermes-agent.nousresearch.com/docs/';
  }
  return `${HERMES_DOCS_BASE_URL}/${slug}`;
}

function slugFromSourcePath(sourcePath: string): string {
  const normalized = sourcePath.split(path.sep).join('/');
  const frontmatterSlug = normalized === 'index.mdx' ? 'index' : undefined;
  if (frontmatterSlug) return frontmatterSlug;

  const withoutExtension = normalized.replace(/\.mdx?$/, '');
  return withoutExtension.replace(/\/index$/, '');
}

function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: '', body: markdown };
  return { frontmatter: match[1], body: markdown.slice(match[0].length) };
}

function extractFrontmatterString(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return undefined;
  const value = match[1].trim();
  if (value === '' || value === '>' || value === '|' || value === '[]') return undefined;
  const quoted = value.match(/^["'](.*)["']$/);
  return (quoted ? quoted[1] : value).trim() || undefined;
}

function firstHeading(body: string): string | undefined {
  const lines = body.split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^#\s+(.+)$/);
    if (match) return stripMarkdown(match[1]).trim();
  }
  return undefined;
}

function extractHeadings(body: string): string[] {
  const headings: string[] = [];
  const lines = body.split(/\r?\n/);
  let inFence = false;
  let sawFirstH1 = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (!match) continue;

    if (match[1].length === 1) {
      if (!sawFirstH1) {
        sawFirstH1 = true; // first H1 is the page title duplicate
        continue;
      }
      continue;
    }
    headings.push(stripMarkdown(match[2]).trim());
  }

  return headings;
}

function normalizeContent(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence) {
      const admonition = line.match(/^:::\s*(\w+)(?:\[(.+?)\])?\s*(.*)$/);
      if (admonition && ['info', 'tip', 'note', 'warning', 'caution', 'danger'].includes(admonition[1])) {
        const label = admonition[2] ?? admonition[3];
        out.push(`**[!${admonition[1].toUpperCase()}]${label ? ` ${label}` : ''}**`);
        continue;
      }
      if (/^:::\s*$/.test(line)) continue;
    }
    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/\{#[^}]*\}/g, '')
    .trim();
}

export function searchDocs(docs: HermesDoc[], query: string, limit = 10): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return [];
  }

  return docs
    .map((doc) => ({ doc, score: scoreDoc(doc, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.doc.slug.localeCompare(b.doc.slug))
    .slice(0, limit)
    .map(({ doc, score }) => ({
      slug: doc.slug,
      title: doc.title,
      description: doc.description,
      url: doc.url,
      section: doc.section,
      headings: doc.headings.slice(0, 8),
      score,
      snippet: makeSnippet(doc, terms),
    }));
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_\-./:]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function scoreDoc(doc: HermesDoc, terms: string[]): number {
  const title = doc.title.toLowerCase();
  const slug = doc.slug.toLowerCase();
  const description = doc.description.toLowerCase();
  const headings = doc.headings.join(' ').toLowerCase();
  const content = doc.content.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (title === term || slug === term || slug.replace(/\//g, '-') === term) score += 100;
    if (title.includes(term)) score += 40;
    if (slug.includes(term)) score += 35;
    if (description.includes(term)) score += 20;
    if (headings.includes(term)) score += 12;
    // Frequency-weighted content score: repeated mentions (e.g. an env var on its
    // reference page) must outrank pages that mention the term only once.
    const occurrences = content.split(term).length - 1;
    if (occurrences > 0) score += Math.min(occurrences, 5) * 8;
  }

  return score;
}

function makeSnippet(doc: HermesDoc, terms: string[]): string {
  const haystacks = [doc.description, doc.content];
  for (const haystack of haystacks) {
    const lower = haystack.toLowerCase();
    const index = terms.map((term) => lower.indexOf(term)).filter((entry) => entry >= 0).sort((a, b) => a - b)[0];
    if (index !== undefined) {
      const start = Math.max(0, index - 80);
      const end = Math.min(haystack.length, index + 220);
      return haystack.slice(start, end).replace(/\s+/g, ' ').trim();
    }
  }
  return doc.description || doc.content.slice(0, 240).replace(/\s+/g, ' ').trim();
}

export function formatDoc(doc: HermesDoc): string {
  const sections = [
    `# ${doc.title}`,
    '',
    `URL: ${doc.url}`,
    `Slug: ${doc.slug}`,
    doc.description ? `Description: ${doc.description}` : undefined,
    doc.headings.length > 0 ? `Headings: ${doc.headings.join(' > ')}` : undefined,
    '## Content',
    '',
    doc.content,
  ];

  return sections.filter((section) => section !== undefined && section !== '').join('\n');
}
