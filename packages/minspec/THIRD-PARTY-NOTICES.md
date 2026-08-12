# Third-Party Notices

The MinSpec extension (`aiclarity.minspec`) is licensed under the MIT License
(see `LICENSE`). Notices required by the licenses of bundled third-party code
are reproduced below.

---

## No notices currently required

The only bundled dependency that has ever required one was `@aiclarity/shared`,
which esbuild's `--bundle` inlines into `out/extension.js`. It was licensed
**MPL-2.0**, so this file carried an MPL §3.3 "Distribution of a Larger Work"
notice naming the covered portions, plus the §3.2 offer of source availability,
and the package shipped the full MPL text as `LICENSE-THIRD-PARTY-MPL-2.0.txt`.

[DR-083](../../docs/decisions/DR-083.md) relicensed `@aiclarity/shared` to
**MIT** on 2026-08-12. Both obligations lapsed with it, so the section and the
bundled MPL text file were removed. The bundled code and the extension around it
are now under the same license, stated once in `LICENSE`.

This file is retained as the destination for any future notice.
