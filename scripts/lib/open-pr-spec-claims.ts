/**
 * Dev-time `gh` reads for the spec-id allocator and advisory check (#3164).
 *
 * This is the ONLY place spec-id work touches the network, and it is under `scripts/`,
 * never `packages/` (constitution invariant 1, DR-004). Every failure throws
 * `SpecIdGateError`: a witness that could not look is a red, never an empty list read as
 * "nothing is claimed" (invariant 2, DR-066).
 *
 * `SPEC_ID_GH_BIN` is a TEST SEAM (like `DR_ID_GH_BIN`): tests point it at a stub so no
 * test reaches the real API. CI never sets it.
 */

import { execFileSync } from 'node:child_process';

import {
  claimedSpecDirsFromPrFiles,
  specDirsFromPaths,
  type SpecPrClaims,
  type SpecPrFileEntry,
} from './spec-id-claims';

export class SpecIdGateError extends Error {}

const GH_BIN = process.env.SPEC_ID_GH_BIN?.trim() || 'gh';

function ghOrFail(args: string[], what: string): string {
  try {
    return execFileSync(GH_BIN, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new SpecIdGateError(`could not ${what} — \`${GH_BIN} ${args.join(' ')}\` failed:\n${(err.stderr || err.message || String(e)).trim()}`);
  }
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SpecIdGateError(`could not parse the ${what} response as JSON. First 200 chars:\n${text.slice(0, 200)}`);
  }
}

/** Flatten `gh api --paginate --slurp` output (array of pages, or a flat array). */
function rows(text: string, what: string): Record<string, unknown>[] {
  const parsed = parseJson(text, what);
  if (!Array.isArray(parsed)) throw new SpecIdGateError(`the ${what} response was not a JSON array.`);
  const out: Record<string, unknown>[] = [];
  for (const el of parsed) {
    for (const row of Array.isArray(el) ? el : [el]) {
      if (!row || typeof row !== 'object') throw new SpecIdGateError(`the ${what} response contained a non-object row.`);
      out.push(row as Record<string, unknown>);
    }
  }
  return out;
}

/** Contents listing of a directory at a ref. A 404 on the root `specs` dir is a red. */
function listDir(repo: string, dir: string, ref: string): Record<string, unknown>[] {
  const endpoint = `repos/${repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`;
  return rows(ghOrFail(['api', endpoint, '--paginate', '--slurp'], `list ${dir} on ${ref}`), `${dir}@${ref} listing`);
}

/** Every spec directory (`specs/<product>/SPEC-N-slug`) on the base branch's current tip. */
export function baseSpecDirs(repo: string, base: string, specsDir: string): string[] {
  const products = listDir(repo, specsDir, base).filter((r) => r.type === 'dir').map((r) => String(r.path ?? ''));
  const dirs: string[] = [];
  for (const product of products) {
    for (const r of listDir(repo, product, base)) {
      if (r.type === 'dir') dirs.push(`${String(r.path ?? '')}/`);
    }
  }
  // listings give directories, not files — a trailing slash + sentinel lets the path
  // matcher (which needs a file under the directory) recognise them.
  return specDirsFromPaths(dirs.map((d) => `${d}x`));
}

/** The spec directories one PR adds. */
export function prSpecDirs(repo: string, pr: number, specsDir: string): string[] {
  const out = ghOrFail(['api', `repos/${repo}/pulls/${pr}/files`, '--paginate', '--slurp'], `list the files changed by PR #${pr}`);
  const entries: SpecPrFileEntry[] = rows(out, `PR #${pr} file list`).map((r) => ({
    filename: String(r.filename ?? ''),
    status: String(r.status ?? ''),
  }));
  return claimedSpecDirsFromPrFiles(entries, specsDir);
}

/**
 * Every open PR's added spec directories, in batched GraphQL pages. A PR with more than
 * 100 files falls back to the paginated REST listing so no claim is read from a
 * truncated list. `exclude` drops one PR (the subject of a check).
 */
export function openPrSpecClaims(repo: string, specsDir: string, exclude?: number): SpecPrClaims[] {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new SpecIdGateError(`--repo must be OWNER/NAME, got "${repo}"`);
  const query =
    'query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){' +
    'pullRequests(states:OPEN,first:50,after:$cursor){pageInfo{hasNextPage endCursor}' +
    'nodes{number files(first:100){pageInfo{hasNextPage} nodes{path changeType}}}}}}';
  const claims: SpecPrClaims[] = [];
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page > 200) throw new SpecIdGateError('the open-PR GraphQL listing did not terminate after 200 pages.');
    const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`];
    if (cursor) args.push('-f', `cursor=${cursor}`);
    const parsed = parseJson(ghOrFail(args, 'list the open pull requests and their files'), 'open-PR GraphQL') as any;
    if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
      throw new SpecIdGateError(`the open-PR GraphQL query returned errors: ${JSON.stringify(parsed.errors).slice(0, 400)}`);
    }
    const prs = parsed?.data?.repository?.pullRequests;
    if (!prs || !Array.isArray(prs.nodes) || typeof prs.pageInfo?.hasNextPage !== 'boolean') {
      throw new SpecIdGateError('the open-PR GraphQL response was not the expected shape.');
    }
    for (const node of prs.nodes) {
      const number = Number(node?.number);
      if (!Number.isFinite(number) || number <= 0 || !node.files || !Array.isArray(node.files.nodes)) {
        throw new SpecIdGateError('the open-PR GraphQL response contained a malformed pull request node.');
      }
      if (number === exclude) continue;
      if (node.files.pageInfo?.hasNextPage !== false) {
        claims.push({ pr: number, dirs: prSpecDirs(repo, number, specsDir) });
        continue;
      }
      const entries: SpecPrFileEntry[] = node.files.nodes.map((f: { path?: unknown; changeType?: unknown }) => ({
        filename: String(f.path ?? ''),
        status: String(f.changeType ?? '').toLowerCase(),
      }));
      claims.push({ pr: number, dirs: claimedSpecDirsFromPrFiles(entries, specsDir) });
    }
    if (!prs.pageInfo.hasNextPage) break;
    cursor = String(prs.pageInfo.endCursor ?? '');
    if (!cursor) throw new SpecIdGateError('the open-PR GraphQL listing said there was another page but gave no cursor.');
  }
  return claims;
}
