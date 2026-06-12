let cache: Array<{ version: string; date: string }> | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchChangelogVersions(): Promise<Array<{ version: string; date: string }>> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  const url = "https://code.claude.com/docs/en/changelog";
  const response = await fetch(url, {
    headers: {
      "User-Agent": "cc-hub/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch changelog: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const versions = parseChangelogHtml(html);

  cache = versions;
  cacheTime = Date.now();
  return versions;
}

export function parseChangelogHtml(html: string): Array<{ version: string; date: string }> {
  const results: Array<{ version: string; date: string }> = [];
  const seen = new Set<string>();

  // Strategy 1: Extract from embedded Next.js component JSON (most reliable)
  // The HTML contains: _jsx(Update, { label: "2.1.173", description: "June 11, 2026", ... })
  const componentRegex = /label:\s*"(\d+\.\d+\.\d+)"[\s\S]*?description:\s*"([^"]{5,60})"/g;
  let match: RegExpExecArray | null;
  while ((match = componentRegex.exec(html)) !== null) {
    const version = match[1];
    const date = match[2].trim();
    if (seen.has(version)) continue;
    seen.add(version);
    results.push({ version, date });
  }

  // Strategy 2: Extract from rendered divs with contenteditable=false
  const versionRegex = /<div[^>]*contenteditable=["']?false["']?[^>]*>(\d+\.\d+\.\d+)<\/div>/gi;
  while ((match = versionRegex.exec(html)) !== null) {
    const version = match[1];
    if (seen.has(version)) continue;
    seen.add(version);

    // Look for a date in the nearby HTML after this match
    const startIdx = match.index + match[0].length;
    const snippet = html.slice(startIdx, startIdx + 500);
    // Try to find date in a <p> tag or a description div
    const dateMatch = snippet.match(/<p>([^<]{5,60})<\/p>/) || snippet.match(/data-component-part=["']?update-description["']?[^>]*>([^<]{5,60})<\/div>/);
    const date = dateMatch ? dateMatch[1].trim() : "";

    results.push({ version, date });
  }

  // Strategy 3: Fallback to heading tags
  const headingRegex = /<h[23][^>]*>(\d+\.\d+\.\d+)[^<]*<\/h[23]>/gi;
  while ((match = headingRegex.exec(html)) !== null) {
    const version = match[1];
    if (seen.has(version)) continue;
    seen.add(version);

    const startIdx = match.index + match[0].length;
    const snippet = html.slice(startIdx, startIdx + 500);
    const dateMatch = snippet.match(/<p>([^<]{5,60})<\/p>/);
    const date = dateMatch ? dateMatch[1].trim() : "";

    results.push({ version, date });
  }

  return results;
}
