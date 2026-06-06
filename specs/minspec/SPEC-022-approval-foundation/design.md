---
id: SPEC-022
type: design
status: implementing
product: minspec
---

# Approval Ground Truth + Derived Status — Design

> Plan phase for [SPEC-022](./requirements.md) — encodes the accepted design
> [DR-034](../../../docs/decisions/DR-034.md). The requirements (FR-1..FR-5,
> INV-1..INV-6, AC-1..AC-10, Contracts) are binding; this is the HOW.

## Approach

The integrity cluster ([#112](https://github.com/harvest316/minspec/issues/112)) has one
root — the approval ground truth's *durability and shape* — so the build is one coupled
change with five seams, shipped **warn-first**:

1. **One canonicalization contract, two twins.** A single pure module computes
   `canonicalizeSpec` / `specHash` (FR-3). It lives in **`packages/shared`** (Tier-0, no
   `vscode`/no network per [DR-014](../../../docs/decisions/DR-014.md)) as a new
   `packages/shared/src/canonical.ts`, consumed by the extension. The PreToolUse gate is
   Python and cannot import a Node package, so it carries a **line-for-line twin**,
   `canonical.py`, alongside [spec-gate.py](../../../scripts/hooks/spec-gate.py). INV-2
   (corpus parity) is the gate that keeps the twins byte-identical.
2. **Committed, path-keyed sidecars** replace the gitignored id-keyed
   `.minspec/approvals.json`. A new `packages/minspec/src/lib/approval-store.ts` owns the
   on-disk shape; [approval.ts](../../../packages/minspec/src/lib/approval.ts)'s id-keyed
   `loadApprovals`/`saveApprovals`/raw-byte hashing is gutted and re-pointed at it.
3. **`deriveStatus` is the single source of truth.** A new
   `deriveStatus(phases, approvalState, explicitTerminal)` in
   [lifecycle.ts](../../../packages/minspec/src/lib/lifecycle.ts) (replacing the
   phases-only `getSpecStatus`, line 75) feeds the validator, the gate, and the
   tool-written literal mirror via
   [`setSpecStatus`](../../../packages/minspec/src/lib/spec.ts) (spec.ts:440).
4. **Gate + validator read derived status.** [spec-gate.py](../../../scripts/hooks/spec-gate.py)
   reads the committed sidecar from `cwd` (the `--git-common-dir` resolution at
   spec-gate.py:56-91 demotes to fallback) and computes status from {phases, approval}; the
   bash `sha256sum` path in [spec-gate.sh](../../../scripts/hooks/spec-gate.sh) and the
   Node `hashSpecFile` go away. [spec-validator.ts](../../../packages/minspec/src/lib/spec-validator.ts)
   gains an INV-4 literal==derived check via the #137 `CLOSED_SET_FIELDS`-style symmetric
   primitive (warn-only).
5. **Migration, then promotion.** A one-shot `scripts/migrate-approvals.ts` converts the
   16 canonical records → committed sidecars (recomputed hashes) and writes
   `migrated:true` sidecars for the 7 unbacked implementing/done specs. The gate ships
   WARN; promotion to ERROR is a later, separate edit gated on *zero migrated + zero
   drift*.

Existing files edited: `approval.ts`, `approve.ts`, `lifecycle.ts`, `spec.ts` (mirror
write only), `spec-validator.ts`, `spec-gate.py`, `spec-gate.sh`, `.gitignore`,
`.gitattributes` (new), the `packages/shared` barrel. New files: `canonical.ts`,
`canonical.py`, `approval-store.ts`, `migrate-approvals.ts`, plus tests.

## Module layout

| File | Status | Gains / loses |
|---|---|---|
| `packages/shared/src/canonical.ts` | **new** | Owns `canonicalizeSpec(raw): string` + `specHash(raw): string` (FR-3). Pure string transform — **no** `parseSpec` dependency (parseSpec applies defaults/coercion that would corrupt the byte contract). Tier-0: `crypto` only, no `vscode`, no fs, no network. Exported via the barrel. |
| `packages/shared/src/index.ts` | edit | Add `export * from './canonical';` next to the existing conformance export. |
| `scripts/hooks/canonical.py` | **new** | Line-for-line Python twin of `canonical.ts`. Pure stdlib (`re`, `hashlib`). Imported by `spec-gate.py`. The contract's second implementation INV-2 guards. |
| `packages/minspec/src/lib/approval-store.ts` | **new** | Path-keyed sidecar read/write replacing `loadApprovals`/`saveApprovals`. Owns sidecar path derivation, `readRecord(rootDir, specPath)`, `writeRecord(...)`, `removeRecord(...)`, `listRecords(rootDir)`. Imports `specHash` from `@aiclarity/shared`. |
| [approval.ts](../../../packages/minspec/src/lib/approval.ts) | edit | **Loses** `hashContent`/`hashSpecFile` (raw-byte), `loadApprovals`/`saveApprovals`/`ApprovalStore` (id-keyed), the inline `ApprovalRecord` (specHash/approvedAt/tier). **Gains** the FR-2 `ApprovalRecord` type, `approvedBy`-capture helper, and re-pointed `getApprovalStatus`/`approveSpec`/`revokeApproval`/`resolveStatus` delegating to `approval-store.ts` + `@aiclarity/shared`. `resolveStatus(record, currentHash)` is unchanged in shape (pure) but `currentHash` is now the **canonical** hash. |
| [lifecycle.ts](../../../packages/minspec/src/lib/lifecycle.ts) | edit | **Gains** `deriveStatus(phases, approvalState, explicitTerminal): SpecStatus` (FR-4 table). `getSpecStatus` (line 75) becomes a thin shim (`deriveStatus(phases, 'approved', undefined)` for the legacy phases-only callers) or is replaced at each call site — see [§deriveStatus](#derivestatus). |
| [spec.ts](../../../packages/minspec/src/lib/spec.ts) | edit | `setSpecStatus` (line 440) is reused unchanged as the **mirror writer**. Drop the stale DR-012 "Editing voids approval (hash in .minspec/approvals.json → stale)" reminder comment emitted by `serializeFrontmatter` (spec.ts:339-342) — it now lies (status edits no longer void). |
| [spec-validator.ts](../../../packages/minspec/src/lib/spec-validator.ts) | edit | **Gains** an INV-4 `status.mirror-drift` warning: literal `status:` vs `deriveStatus(...)`. Routed through the same evidence-based symmetric discipline as `CLOSED_SET_FIELDS` (spec-validator.ts:488-501) — a present-but-wrong value warns, never blocks. |
| [spec-gate.py](../../../scripts/hooks/spec-gate.py) | edit | Reads committed sidecar from `cwd/.minspec/approvals/<path>.json` first; `canonical_minspec_dir` (line 56) demoted to fallback. Status check switches from literal `status` (line 159) to derived. `sha()` raw-byte (line 48) replaced by `canonical.py`'s `spec_hash`. |
| [spec-gate.sh](../../../scripts/hooks/spec-gate.sh) | edit | No behavioural change beyond ensuring `canonical.py` ships beside `spec-gate.py`; the bash `sha256sum` path was already only referenced in comments — confirm none remains. |
| `scripts/migrate-approvals.ts` | **new** | FR-5 one-shot. `tsx` script (matches `validate-frontmatter.ts`). |
| [.gitignore](../../../.gitignore) | edit | Remove the `.minspec/approvals.json` entry (line ~39). |
| `.gitattributes` | **new** | `specs/** text eol=lf` (FR-3 belt-and-suspenders). |

### Why `packages/shared`, not `packages/minspec/src/lib/canonical.ts`

DR-034 §3 names the home conditionally ("a shared module … the natural home if the Python
twin must not import vscode"). The twin **is** Python and cannot import `vscode`, and
`canonical.ts` is pure (`crypto` + string ops). `packages/shared` is exactly the Tier-0,
no-vscode/no-network package for this ([DR-014](../../../docs/decisions/DR-014.md)); it is
already consumed by minspec via the package name (`@aiclarity/shared`, see
[bridge.ts:29](../../../packages/minspec/src/lib/bridge.ts)) so no new wiring. Putting it in
`minspec/src/lib` would couple a contract that the gate twin must mirror to the
vscode-bearing extension package. **Decision: `packages/shared/src/canonical.ts`.**

## canonicalizeSpec / specHash

`canonicalizeSpec(raw: string): string` implements FR-3's five steps as a **standalone
string transform** — it must NOT route through `parseSpec`, whose default-injection
(`tier ?? 'T2'`, `status ?? 'new'`, line 252-278) and re-serialization would change bytes
and break the byte contract. Algorithm:

```
1. Normalize EOL up front: raw.replace(/\r\n?/g, '\n')   (deterministic before splitting)
2. Match the frontmatter block: /^---\n([\s\S]*?)\n---\n?/  (same anchor as FRONTMATTER_RE,
   spec.ts:85). No frontmatter → body is the whole string, skip step 3.
3. From the frontmatter block, REMOVE lifecycle keys:
     - drop any top-level line matching /^status[ \t]*:/
     - drop the `phases:` line AND its immediately-following indented children
       (/^\s+\w/ run): scan line-by-line, when a line matches /^phases[ \t]*:/ enter
       "phases block" mode and drop it + every subsequent /^[ \t]+/ line until a line
       that is NOT indented (a new top-level key or blank), then exit the mode.
     - KEEP every other line verbatim (id, tier, type, epic, product, title,
       superseded-by, created, depends_on, relates_to, aspects, comments, blanks).
4. Rejoin: '---\n' + frontmatterMinusLifecycle + '\n---\n' + body. (When there was no
   frontmatter, the result is just the normalized body.)
5. Normalize: split on '\n', `trimEnd()` each line (strip trailing per-line WS), join with
   '\n', then collapse a trailing-newline run to EXACTLY ONE: result.replace(/\n*$/,'') + '\n'.
6. specHash(raw) = sha256hex(Buffer.from(canonicalizeSpec(raw), 'utf-8')).
```

**Frontmatter-key removal — exact rules.** Removal is *line-oriented over the frontmatter
block only*, never the body (a `status:` token in prose is content). The `phases:` block
ends at the first non-indented line — matching how `parseFrontmatterYaml`
(spec.ts:148-199) treats a nested block. Inline-comment lines (`# Editing voids…`,
spec.ts:342) are body of the frontmatter block — KEPT, since they are not `status`/`phases`
(and after this spec that reminder line is removed at the source, see §Gate & validator).
A `status:`/`phases:` key with an inline comment (`status: implementing  # note`) is still
dropped wholesale — the whole line goes.

**Node↔Python byte parity.** The twin (`canonical.py`) implements the identical line
algorithm with stdlib `re`:

```python
def canonicalize_spec(raw: str) -> str:
    raw = re.sub(r'\r\n?', '\n', raw)
    m = re.match(r'^---\n([\s\S]*?)\n---\n?', raw)   # same anchor as the Node regex
    if not m:
        body = raw; fm_clean = None
    else:
        fm = m.group(1); body = raw[m.end():]
        fm_clean = _strip_lifecycle(fm)              # drop status line + phases block
    joined = body if fm_clean is None else '---\n' + fm_clean + '\n---\n' + body
    lines = [ln.rstrip() for ln in joined.split('\n')]
    return re.sub(r'\n*$', '', '\n'.join(lines)) + '\n'

def spec_hash(raw: str) -> str:
    return hashlib.sha256(canonicalize_spec(raw).encode('utf-8')).hexdigest()
```

Parity is enforced by **shared, language-neutral fixtures**, not by trusting two prose
specs to agree:
- The corpus parity test (`packages/minspec/tests/canonical-parity.test.ts`, INV-2/AC-5)
  walks every `specs/**/*.md`, computes `specHash` in Node, shells `python3
  scripts/hooks/canonical.py --hash <file>` (a thin CLI mode added to `canonical.py`), and
  asserts equality file-by-file. It runs in CI `test` job (Python 3 is present on
  `ubuntu-latest`). When `python3` is absent the test **skips with a logged warning**
  (mirrors `approval.test.ts:35-39`'s `sha256sum` skip) so local non-Python dev is not
  blocked, but CI always has it.
- A small `tests/fixtures/canonical/*.md` set pins the *exact* canonical output (golden
  strings) for the tricky cases: CRLF input, trailing-WS lines, `phases:` block with
  comments interleaved, frontmatter-absent file, `status`/`phases` with inline comments,
  multiple trailing newlines. Both the Node unit test and a Python unit test
  (`scripts/hooks/test_canonical.py`) assert against the same goldens, so divergence fails
  *before* the corpus test and points at the exact rule.

## ApprovalRecord & path-keyed store

**TS type** (FR-2 Contract; replaces the lean `ApprovalRecord` at approval.ts:22-26):

```ts
export interface ApprovalRecord {
  readonly specPath: string;   // repo-relative, e.g. specs/minspec/SPEC-007-foo/requirements.md
  readonly specHash: string;   // canonical hash (FR-3), hex
  readonly approvedAt: string; // ISO-8601 UTC
  readonly approvedBy: string; // git config user.email at approval time
  readonly tier: Tier;         // from ./config
  readonly migrated: boolean;  // true only for FR-5 backfilled records
}
```

**On-disk shape.** One JSON object **per file** (not a map — the file's *path* is the key),
pretty-printed + trailing newline (matches `saveApprovals`, approval.ts:78):

```
.minspec/approvals/specs/minspec/SPEC-007-foo/requirements.md.json
{
  "specPath": "specs/minspec/SPEC-007-foo/requirements.md",
  "specHash": "4baf6583…",
  "approvedAt": "2026-06-06T01:12:00.000Z",
  "approvedBy": "paul@harvest316.com",
  "tier": "T3",
  "migrated": false
}
```

**Path-key derivation** (`approval-store.ts`): given the spec's repo-relative path
`p` (POSIX-normalized, `\\`→`/`), the sidecar is
`join(rootDir, '.minspec', 'approvals', p + '.json')`. Reverse (used by `listRecords` and
migration verification): strip the `.minspec/approvals/` prefix and the trailing `.json`.
`p` is computed `path.relative(rootDir, specFilePath)` then `.split(path.sep).join('/')`
so Windows and POSIX produce the same key (INV-5: a path is inherently unique → no two
specs share a record). `writeRecord` `mkdir -p`s the nested sidecar dir.

**New store API** (replaces id-keyed `loadApprovals`/`saveApprovals`):

```ts
function sidecarPath(rootDir: string, specRelPath: string): string;
function readRecord(rootDir: string, specRelPath: string): ApprovalRecord | undefined;
function writeRecord(rootDir: string, rec: ApprovalRecord): void;       // writes one sidecar
function removeRecord(rootDir: string, specRelPath: string): boolean;   // unlinks one sidecar
function listRecords(rootDir: string): ApprovalRecord[];                // glob .minspec/approvals/**/*.json
```

`readRecord` keeps the existing shallow shape-validation (approval.ts:60-68) — drop a
malformed sidecar rather than throw, but now over a single object.

**`approve.ts` changes** ([approve.ts:139-157](../../../packages/minspec/src/commands/approve.ts)).
The flip-then-hash dance is **deleted** — FR-3 means status edits don't void the hash, so
ordering is free:

```ts
const email = gitConfigEmail(rootDir);                       // see below
if (wasPreImpl) setSpecStatus(spec.filePath, 'implementing'); // mirror; no longer affects hash
recordApproval(rootDir, specRelPath(rootDir, spec.filePath), spec.filePath, spec.tier, email);
```

`recordApproval` (`approveSpec` in approval.ts) computes `specHash` via
`@aiclarity/shared` over the file's **current content** (status flip already applied — and
irrelevant to the hash), builds the FR-2 record with `migrated:false`, and `writeRecord`s
the sidecar. The id parameter (`spec.id`) is **dropped** from the signature — the store is
path-keyed; `pickSpec` (approve.ts:55) still uses `s.id` only for the quick-pick label.

**`approvedBy` capture (Tier-0, offline).** A new helper in `approval.ts`:

```ts
function gitConfigEmail(rootDir: string): string {
  try {
    return execFileSync('git', ['config', 'user.email'], { cwd: rootDir })
      .toString().trim() || 'unknown';
  } catch { return 'unknown'; }
}
```

`execFileSync` is local, headless, no network — AC-3's "no network call". An empty/missing
`user.email` degrades to `'unknown'` (honest, never throws — never blocks an approval on
git config).

**`resolveStatus`** (approval.ts:85-92) is unchanged in *shape* (still pure
`(record, currentHash) → 'approved'|'stale'|'unapproved'`), but `getApprovalStatus`
(approval.ts:95-102) now feeds it `specHash(readFileSync(specFilePath, 'utf-8'))` (canonical)
instead of `hashSpecFile` (raw bytes), and reads the record via `readRecord` keyed by path.

## deriveStatus

`deriveStatus` is added to [lifecycle.ts](../../../packages/minspec/src/lib/lifecycle.ts),
encoding the FR-4 table exactly. It takes the approval verdict and an explicit terminal,
the two inputs `getSpecStatus` (line 75) lacked:

```ts
export type ExplicitTerminal = 'archived' | 'superseded' | undefined;

export function deriveStatus(
  phases: PhaseState,
  approvalState: ApprovalStatus,        // 'approved' | 'stale' | 'unapproved' (incl. migrated→approved-but-flagged)
  explicitTerminal: ExplicitTerminal,
): SpecStatus {
  if (explicitTerminal) return explicitTerminal;            // INV-6 — human act, never inferred
  if (allPending(phases)) return 'new';
  if (approvalState !== 'approved') return 'specifying';     // INV-1 — unapproved cannot pass
  if (allRequiredDone(phases)) return 'done';                // v1: see #116 deferral
  return 'implementing';
}
```

- `allPending`/`allRequiredDone` reuse the phase-scan loop from `getSpecStatus`
  (lifecycle.ts:79-91).
- **#116 `done`-deferral.** Split-layout specs have no task checkboxes, so
  `allRequiredDone` cannot yet be driven by task completion. v1 keeps the existing
  implement-phase signal: `done` only when every required phase is `done`/`skipped` (the
  current `allComplete` semantics). This matches the FR-4 caveat — `new`/`specifying`/
  `implementing` are fully derived now; full `done`-from-tasks is deferred (Out of scope).
- **`getSpecStatus` callers.** Audit every caller (the SPECS tree provider, the status
  bar, `advancePhase`/`skipPhase`/`goBackToPhase` `newStatus` fields). Callers that have an
  approval verdict + spec path switch to `deriveStatus`; the pure transition helpers
  (`advancePhase` etc.) keep a phases-only derivation for their `newStatus` preview — they
  model a *transition*, not the authoritative spec status — so `getSpecStatus` survives as
  an internal shim `deriveStatus(phases, 'approved', undefined)` documented as
  "preview-only; the gate/validator use the approval-aware `deriveStatus`".

**Literal mirror.** The literal `status:` line is written **only** by the tool, via
`setSpecStatus` (spec.ts:440) — already a surgical line rewrite that preserves comments and
order. `approve.ts` writes it on approval; a future lifecycle transition writes it when
phases advance. It is never authoritative — it is a cache of `deriveStatus`.

**Validator asserts literal == derived (INV-4, warn).** In
[spec-validator.ts](../../../packages/minspec/src/lib/spec-validator.ts), add a check after
the closed-set loop (spec-validator.ts:645-647): read the raw literal `status` via the
existing `rawFrontmatterField(raw, 'status')` (spec-validator.ts:404), compute
`deriveStatus(...)`, and on mismatch push `status.mirror-drift` (severity `warning`,
matching the §137 discipline at spec-validator.ts:422-436 — never an error, so foreign
vocabularies and incremental authoring are not blocked). `validateSpec` needs the approval
verdict + explicit terminal; these are passed in by the caller (the validate command /
approve command already have `rootDir` + the parsed spec) as an optional
`approvalState`/`explicitTerminal` argument, skipped (no warning) when absent — same
no-false-positive pattern as the optional `knownEpicRefs` (spec-validator.ts:594).

**Gate + CI read derived.** The gate (next section) computes status from {phases, sidecar}
not the literal line; `validate-frontmatter.ts` (CI) likewise. INV-1 thus becomes
*structural*: `implementing`/`done` cannot be produced without an approved sidecar.

## Gate & validator changes

**`spec-gate.py`** ([scripts/hooks/spec-gate.py](../../../scripts/hooks/spec-gate.py)):

- **Read the committed sidecar from `cwd` first.** For each gated spec at `cwd/specs/...`,
  derive the sidecar path `cwd/.minspec/approvals/<rel>.json` and read it. The
  `canonical_minspec_dir(cwd)` `--git-common-dir` resolution (lines 56-91, 133-138) is
  **demoted to a fallback**: consult it only for an *uncommitted local* approval during
  authoring when the `cwd` sidecar is absent. A committed sidecar exists in every
  clone/worktree/CI checkout, so the common-dir read is no longer load-bearing (FR-1).
- **Status is derived, not literal.** Replace the literal `status != "implementing"` test
  (line 159-161) with: parse `phases:` from the frontmatter, compute the approval verdict
  (sidecar present + `specHash` matches `canonical.py`'s `spec_hash` of the file), and call
  a Python `derive_status(phases, approval, explicit_terminal)` mirroring `deriveStatus`.
  Gate on derived ∈ {implementing, done} (T3/T4 only, as today).
- **Hashing → canonical.** `import canonical` (sibling module); replace `sha(path)` raw-byte
  (lines 48-53) with `canonical.spec_hash(open(path,encoding='utf-8').read())`.
- **migrated handling (WARN phase).** A `migrated:true` sidecar counts as *approved* for the
  derive (non-blocking, FR-5) but the deny/warn message notes "approval migrated — re-approve
  to clear". In the WARN phase the gate **emits the message but still `allow()`s**; promotion
  flips that to `deny()` (a 1-line change, deferred).
- **fail-closed unchanged** for the case where neither the `cwd` sidecar nor the fallback
  resolves AND gated specs exist (lines 175-182) — preserves the DR-031 fail-closed
  guarantee.

**`spec-gate.sh`** ([scripts/hooks/spec-gate.sh](../../../scripts/hooks/spec-gate.sh)): the
bash `sha256sum` hashing path DR-034 calls out is already comment-only here; the wrapper
keeps its kill-switch + audit-log logic. Confirm `canonical.py` is co-located so
`spec-gate.py`'s `import canonical` resolves (both in `scripts/hooks/`).

**`.gitattributes`** (new, repo root): `specs/** text eol=lf` — VCS-layer EOL
normalization reinforcing canonicalization step 5 (FR-3, AC-4).

**`.gitignore`** ([.gitignore](../../../.gitignore)): delete the `.minspec/approvals.json`
block (~line 39). The committed `.minspec/approvals/` tree is intentionally tracked (AC-1).

## Migration

`scripts/migrate-approvals.ts` (`tsx`, FR-5), idempotent, one-shot:

1. **Convert the 16 canonical records → committed sidecars.** Read
   `<canonical>/.minspec/approvals.json` (resolved via `git rev-parse --git-common-dir`,
   the same path the gate used). For each id-keyed record, resolve the spec **file** it
   refers to (map `id` → the `specs/**/*.md` whose `id:` frontmatter matches; the primary
   requirements artifact when a dir has several files), **recompute** `specHash` under FR-3
   canonicalization (raw-byte hashes are invalid now), set `approvedBy` = repo owner's
   `git config user.email`, `migrated:false`, carry `tier`/`approvedAt`, and `writeRecord`.
   *Note:* the live store holds **16** records (the 15 DR-034 enumerated **plus SPEC-022's
   own** local approval — see dogfood below); both convert the same way.
2. **Backfill the 7 unbacked implementing/done specs.** The specs that *derive* to
   implementing/done with no source record:
   `specs/minspec/requirements.md` (SPEC-001), `specs/minspec/design.md` (SPEC-002),
   `specs/minspec/tasks.md` (SPEC-003), `specs/minspec/SPEC-004-*` (requirements/design/
   tasks), `specs/agent-execute/SPEC-016-reality-check/requirements.md`. For each, write a
   sidecar with `specHash` = canonical hash of current content, `approvedBy` = owner,
   `approvedAt` = migration date, `tier`, and **`migrated:true`** — *honest provenance*: an
   approval the human never performed, flagged so the gate treats it valid-but-flagged
   ("re-approve to clear"). No manufactured "human approved at hash X" claim (the
   evidence-discipline value, [DR-003](../../../docs/decisions/DR-003.md)).
   The exact set is computed at run time (derive over the corpus, minus specs that already
   got a converted record in step 1) rather than hardcoded, so the script is correct even
   if the corpus shifts before it runs.
3. **Dogfood — migrate SPEC-022's own approval.** SPEC-022's local approval (id `SPEC-022`,
   hash `94411b78…` in the live store) converts in step 1 to a committed
   `.minspec/approvals/specs/minspec/SPEC-022-approval-foundation/requirements.md.json`
   with `migrated:false` and the recomputed canonical hash. **This is what unblocks merging
   the branch** — once SPEC-022's own ground truth is committed, a fresh checkout/CI sees it
   backed, so the gate (reading derived status from the committed sidecar) does not flag
   SPEC-022 itself.
4. **WARN→ERROR promotion gate.** Promotion is a *separate, later* edit (one line in
   `spec-gate.py`: migrated/stale → `deny` instead of `allow`+message). It is allowed only
   when a `scripts/check-approval-corpus.ts` (or the validate run) reports **zero `migrated`
   records AND zero literal/derived drift** across `specs/`. Until then the gate WARNs. No
   flag day (FR-5).

## Test plan

T0 invariant tests are written **first** and must **fail against pre-change code, pass
after** (AC-10). Test files (vitest under `packages/minspec/tests/`, Python under
`scripts/hooks/`):

| ID | Maps to | Test file · case |
|---|---|---|
| INV-1 / AC-6 | structural approval requirement | `approval-store.test.ts` + `lifecycle.test.ts` · `deriveStatus` returns `specifying` for an unapproved spec **regardless of literal status**; returns `implementing`/`done` only when a hash-matching sidecar exists. |
| INV-2 / AC-5 | Node ≡ Python hash | `canonical-parity.test.ts` · for every `specs/**/*.md`, Node `specHash` == `python3 canonical.py --hash`; skips (warns) only if `python3` absent. Plus `scripts/hooks/test_canonical.py` golden-fixture parity. |
| INV-3 / AC-4 | lifecycle-edit non-void | `canonical.test.ts` · editing only `status`/`phases` leaves `specHash` unchanged; editing body OR any other frontmatter field (`id`,`tier`,`epic`,`title`) changes it; CRLF and LF copies hash identically. |
| INV-4 / AC-7 | mirror consistency | `spec-validator.test.ts` · literal `status:` ≠ `deriveStatus` → one `status.mirror-drift` **warning** (never error, never silent); gate/CI use derived. |
| INV-5 / AC-2 | key uniqueness | `approval-store.test.ts` · `sidecarPath` is a pure function of the repo-relative spec path; two distinct spec paths → two distinct sidecars; same spec path → same sidecar (the merge-conflict-on-same-spec property). |
| INV-6 / AC-8 | terminal honesty | `lifecycle.test.ts` · `deriveStatus` returns `archived`/`superseded` **only** when `explicitTerminal` is set; never inferred from any phases configuration. |
| AC-1 | committed sidecar | `approve-command.test.ts` · approving writes `.minspec/approvals/<path>.json`; a fresh tmp "clone" (copy w/o `.minspec/approvals.json`) still sees the record. |
| AC-3 | attributed, offline | `approval.test.ts` · record carries all 6 fields; `approvedBy` == stubbed `git config user.email`; approval performs no network (assert via no-network test harness / `execFileSync` only). |
| AC-9 | migration | `migrate-approvals.test.ts` · 16 fixture records → committed sidecars with **recomputed** canonical hashes (≠ raw-byte); the unbacked specs get `migrated:true`; a corpus checker reports migrated>0 (so promotion stays blocked) pre-clean. |
| AC-10 | T0 discipline | each INV test above includes a documented "fails pre-change" assertion against the old raw-byte/id-keyed/phases-only code path. |

Existing suites updated, not deleted: `approval.test.ts` (drop the `sha256sum` cross-check
at lines 31-50 — the bash path is gone; replace with the canonical-parity skip pattern),
`approve-command.test.ts`/`approve-action.test.ts` (id-keyed → path-keyed; remove
flip-then-hash assertions), `lifecycle.test.ts` (`getSpecStatus` shim + `deriveStatus`),
`spec.test.ts` (the dropped DR-012 reminder comment).

## Build order

Thinnest end-to-end slice first (vertical slices, global DR-359), then widen:

1. **Canonical contract + INV-3.** `packages/shared/src/canonical.ts` + barrel export +
   `canonical.test.ts` (INV-3, golden fixtures). No store, no status yet. Proves the hash
   contract in isolation.
2. **Python twin + INV-2.** `scripts/hooks/canonical.py` (+ `--hash` CLI) +
   `canonical-parity.test.ts` + `test_canonical.py`. Locks the twins together before
   anything depends on them.
3. **Path-keyed store + INV-5.** `approval-store.ts` + `approval-store.test.ts`. Re-point
   `approval.ts`'s `approveSpec`/`getApprovalStatus`/`resolveStatus`/`revokeApproval`;
   drop raw-byte hashing.
4. **One spec end-to-end.** Wire `approve.ts` to the new store + `gitConfigEmail`; drop
   flip-then-hash; approve **SPEC-007** (a single dir) → a committed sidecar. Manual
   verify: fresh-copy still backed.
5. **deriveStatus + mirror + INV-1/INV-4/INV-6.** `deriveStatus` in `lifecycle.ts`;
   validator `status.mirror-drift`; update `getSpecStatus` callers. Tests for INV-1/4/6.
6. **Gate twin.** `spec-gate.py`: derived status, committed-sidecar-first read, common-dir
   fallback, `canonical.py` hashing. WARN phase.
7. **Migration + AC-9.** `migrate-approvals.ts`; run it (16 → sidecars, 7 migrated incl.
   SPEC-022 dogfood); `.gitignore`/`.gitattributes`. Commit the `.minspec/approvals/` tree.
8. **Corpus widen.** Run the full corpus parity (INV-2) + the validate run over all specs;
   confirm green; leave promotion (WARN→ERROR) as a tracked, separate follow-up gated on
   zero-migrated + zero-drift.

## Risks

| Risk (DR-034) | Design-level mitigation |
|---|---|
| **Canonicalization divergence across impls** (highest, DR-034 #1). | One pure `canonical.ts` + one `canonical.py`; **shared golden fixtures** asserted by both a Node and a Python unit test (divergence fails before the corpus test, pinpointing the rule); INV-2 corpus parity in CI on every change; the bash `sha256sum` path dropped entirely so there is no third impl to drift. |
| **Migration manufacturing approvals.** | `migrated:true` provenance flag on every backfilled record; the 7 unbacked specs are **never** emitted as unflagged human approvals; the gate message says "migrated — re-approve to clear"; promotion to ERROR is blocked until zero migrated remain. |
| **Committed-store merge conflicts.** | Per-spec, path-keyed sidecars (one object per file). Two devs approving *different* specs touch different files (no conflict, AC-2); same-spec double-approve conflicts on one tiny JSON — a genuine conflict worth surfacing, with `git log <sidecar>` as the history. |
| **Promoting WARN→ERROR too early.** | The gate ships WARN; promotion is a separate one-line edit gated on a corpus checker (`check-approval-corpus.ts`) reporting zero `migrated` + zero literal/derived drift. No flag day; the WARN phase exercises the full path without blocking. |
| **Hidden literal-status consumers.** | Audit every reader of `frontmatter.status` (the SPECS tree, status bar, `pickSpec` label, the gate, `validate-frontmatter.ts`) before making the literal a mirror; the INV-4 `status.mirror-drift` validator warning then surfaces any consumer that re-introduces drift, and the gate/CI read **derived** status so a stale literal can never gate. |
| **`getSpecStatus` semantics shift** (new). | Kept as a documented preview-only shim for the pure transition helpers (`advancePhase` etc.) so their `newStatus` previews don't silently change; authoritative status flows through `deriveStatus`. Covered by `lifecycle.test.ts` regression. |
