# Third-Party Notices

The MinSpec extension (`aiclarity.minspec`) is licensed under the MIT License
(see `LICENSE`). It bundles third-party code whose licenses and notices are
reproduced below, as required by those licenses.

---

## @aiclarity/shared — Mozilla Public License 2.0

This extension's compiled output (`out/extension.js`) is produced by esbuild
with `--bundle`, which **inlines the `@aiclarity/shared` package** (the T1–T4
complexity-classifier engine and contract types) into the extension bundle.

`@aiclarity/shared` is licensed under the **Mozilla Public License, v. 2.0
(MPL-2.0)**, not MIT. Per MPL-2.0 §3.3 (Distribution of a Larger Work), this
notice informs you that:

- **Which files are MPL-covered:** the portions of `out/extension.js` that
  originate from `@aiclarity/shared` are governed by the MPL-2.0. All other
  code in this extension is governed by the MIT License (`LICENSE`).
- **Full license text:** the complete MPL-2.0 license text is included in this
  package as `LICENSE-THIRD-PARTY-MPL-2.0.txt`. You can also obtain a copy at
  <https://mozilla.org/MPL/2.0/>.
- **Where to get the source (MPL-2.0 §3.2):** the Source Code Form of
  `@aiclarity/shared` is published at
  <https://github.com/harvest316/minspec>, under `packages/shared/`.

MPL-2.0 is a file-level (weak) copyleft license: modifications to the MPL-2.0
source files of `@aiclarity/shared` must be made available under the MPL-2.0,
while the MIT-licensed extension that links/bundles it is unaffected. See
`docs/decisions/DR-018.md` in the source repository for the rationale.

Copyright (c) Audit&Fix. Licensed under the Mozilla Public License, v. 2.0.
