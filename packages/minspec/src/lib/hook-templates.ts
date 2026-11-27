/**
 * hook-templates.ts — verbatim, byte-exact copies of the Claude Code hooks this
 * repo itself runs, embedded so the harness scaffolder can write them into any
 * MinSpec-initialized project that uses Claude Code (AIClarityAU/minspec#1093).
 *
 * WHY base64 (not a template literal): the wrapper is dense with shell `${VAR}`
 * expansions (`${BASH_SOURCE[0]}`, `${MINSPEC_SESSION_TITLE_OFF:-0}`) — every one
 * of which a TS template literal would read as an interpolation — and the Python
 * hook is dense with regex backslashes. Hand-escaping that is a correctness hazard:
 * one missed escape silently corrupts a scaffolded hook. base64 needs zero escaping,
 * so the embedded copy is byte-identical to this repo's own working file.
 *
 * Decoding is offline + deterministic (Buffer, no network) — Tier-0 safe (DR-004).
 *
 * GENERATED from the repo's real `.claude/hooks/*` by scripts/gen-ci-templates.mjs.
 * Do not hand-edit the base64 blobs — run `node scripts/gen-ci-templates.mjs` to
 * regenerate. `npm run validate` fails with a stale-file error (and the fix command)
 * if this file drifts from that.
 */

/** Decode a base64-embedded template back to its exact UTF-8 source bytes. */
function decode(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** Shebang the scaffolded session-title wrapper carries on line 1. */
export const SESSION_TITLE_SH_SHEBANG = '#!/usr/bin/env bash';

/** Shebang the scaffolded session-title hook carries on line 1. */
export const SESSION_TITLE_PY_SHEBANG = '#!/usr/bin/env python3';

/** Verbatim body of `.claude/hooks/session-title.sh` (shebang stripped — supplied via preamble). */
export const SESSION_TITLE_SH: string = decode(
  [
    'IyBzZXNzaW9uLXRpdGxlLnNoIOKAlCBVc2VyUHJvbXB0U3VibWl0IHdyYXBwZXIgZm9yIHNlc3Npb24tdGl0bGUucHkKIwojIFNj',
    'YWZmb2xkZWQgYnkgTWluU3BlYyAoYE1pblNwZWM6IEluaXRpYWxpemUgU0REIFN0cnVjdHVyZWAgLyBgUmVmcmVzaCBIYXJuZXNz',
    'CiMgRmlsZXNgKSBpbnRvIGV2ZXJ5IENsYXVkZS1Db2RlLXVzaW5nIHByb2plY3QsIGFuZCByZWdpc3RlcmVkIGFzIGEKIyBgVXNl',
    'clByb21wdFN1Ym1pdGAgaG9vayBpbiAuY2xhdWRlL3NldHRpbmdzLmpzb24uCiMKIyBUaGluIHdyYXBwZXI6IHRoZSByZWFsIGxv',
    'Z2ljIGxpdmVzIGluIHRoZSAucHkgc28gdGhlIEpTT04gZW52ZWxvcGUgb24gc3RkaW4KIyByZWFjaGVzIGl0IGNsZWFubHkgKGEg',
    'YHB5dGhvbjMgLSA8PEhFUkVET0NgIGZvcm0gd291bGQgc3RlYWwgc3RkaW4pLiBSZXNvbHZlcwojIHRoZSAucHkgYXMgaXRzIG93',
    'biBzaWJsaW5nLCBzbyB0aGUgcGFpciB3b3JrcyBmcm9tIHdoYXRldmVyIGRpcmVjdG9yeSB0aGUKIyBoYXJuZXNzIHNjYWZmb2xk',
    'cyBpdCBpbnRvLgojCiMgT3B0IG91dCBmb3IgYSBzZXNzaW9uIHdpdGggTUlOU1BFQ19TRVNTSU9OX1RJVExFX09GRj0xLgoKc2V0',
    'IC11byBwaXBlZmFpbAoKSEVSRT0iJChjZCAiJChkaXJuYW1lICIke0JBU0hfU09VUkNFWzBdfSIpIiAmJiBwd2QpIgoKaWYgWyAi',
    'JHtNSU5TUEVDX1NFU1NJT05fVElUTEVfT0ZGOi0wfSIgPSAiMSIgXTsgdGhlbgogIGV4aXQgMApmaQoKIyBGYWlsIG9wZW4gaWYg',
    'cHl0aG9uMyBpcyB1bmF2YWlsYWJsZSDigJQgYSBjb3NtZXRpYyB0aXRsZSBuZXZlciBibG9ja3MgYSB0dXJuLgppZiAhIGNvbW1h',
    'bmQgLXYgcHl0aG9uMyA+L2Rldi9udWxsIDI+JjE7IHRoZW4KICBleGl0IDAKZmkKCmV4ZWMgcHl0aG9uMyAiJEhFUkUvc2Vzc2lv',
    'bi10aXRsZS5weSIK',
  ].join(''),
);

/** Verbatim body of `.claude/hooks/session-title.py` (shebang stripped — supplied via preamble). */
export const SESSION_TITLE_PY: string = decode(
  [
    'IiIic2Vzc2lvbi10aXRsZS5weSDigJQgVXNlclByb21wdFN1Ym1pdCBob29rOiBhcHBlbmQgYXBwcm92YWJsZSBJRHMgdG8gdGhl',
    'IENDIHNlc3Npb24gdGl0bGUuCgpDbGF1ZGUgQ29kZSBsZXRzIGEgYFVzZXJQcm9tcHRTdWJtaXRgIChhbmQgYFNlc3Npb25TdGFy',
    'dGApIGhvb2sgc2V0IHRoZSBzZXNzaW9uCnRpdGxlIGJ5IGVtaXR0aW5nIGBob29rU3BlY2lmaWNPdXRwdXQuc2Vzc2lvblRpdGxl',
    'YC4gVGhlIHRpdGxlIHNob3dzIGluIHRoZQpwcm9tcHQgYm94LCB0aGUgYC9yZXN1bWVgIHBpY2tlciwgYW5kIHRoZSB0ZXJtaW5h',
    'bCB0YWIgdGl0bGUsIGFuZCBpcyBwZXJzaXN0ZWQKdG8gdGhlIHNlc3Npb24gdHJhbnNjcmlwdCBhcyBhIGB7InR5cGUiOiJjdXN0',
    'b20tdGl0bGUifWAgcmVjb3JkLgoKVGhpcyBob29rIGNvbXBvc2VzOgoKICAgIDxDbGF1ZGUncyBvd24gYXV0by1zdW1tYXJ5PiDi',
    'gJQgU1BFQy0wMTkgRFItMDcxICMxMDgyCgpzbyB0aGUgdGFiIHN0aWxsIHNheXMgd2hhdCB0aGUgc2Vzc2lvbiBpcyAqYWJvdXQq',
    'LCB3aXRoIHRoZSBhcHByb3ZhYmxlIElEcyB0aGUKc2Vzc2lvbiBhY3R1YWxseSB0b3VjaGVkIGFwcGVuZGVkIG9uIHRoZSBlbmQu',
    'CgpSdWxlczoKICAtIElEcyBjb21lIGZyb20gdGhlIFVTRVIncyB0eXBlZCBwcm9tcHRzIG9ubHkgKG5ldmVyIHRvb2wgb3V0cHV0',
    'IG9yIGFzc2lzdGFudAogICAgdGV4dCksIHNvIHJlYWRpbmcgYGRvY3MvZGVjaXNpb25zL0lOREVYLm1kYCBkb2VzIG5vdCBmbG9v',
    'ZCB0aGUgdGl0bGUuCiAgLSBNb3N0LXJlY2VudGx5LW1lbnRpb25lZCBmaXJzdCwgZGVkdXBlZCwgY2FwcGVkIHNvIHRoZSB3aG9s',
    'ZSB0aXRsZSBmaXRzIHRoZQogICAgaGFybmVzcydzIDIwMC1jaGFyYWN0ZXIgbGltaXQuCiAgLSBBIHNlc3Npb24gc3RhcnRlZCB3',
    'aXRoIGV4YWN0bHkgYC9jaGllZi1vZi1zdGFmZmAga2VlcHMgdGhlIGZpeGVkIHRpdGxlCiAgICAiQ2hpZWYgb2YgU3RhZmYiIHJl',
    'Z2FyZGxlc3Mgb2YgcmVmcy4KICAtIE5vIElEcyBmb3VuZCAtPiBlbWl0IG5vdGhpbmcsIGxlYXZpbmcgQ2xhdWRlIENvZGUncyBv',
    'd24gdGl0bGUgdW50b3VjaGVkLgogIC0gRXZlcnkgZmFpbHVyZSBwYXRoIGlzIHNpbGVudCBhbmQgbm9uLWJsb2NraW5nOiBhIHRp',
    'dGxlIGlzIGNvc21ldGljLCBhbmQgYQogICAgYnJva2VuIGhvb2sgbXVzdCBuZXZlciBjb3N0IHRoZSB1c2VyIGEgdHVybi4KIiIi',
    'Cgpmcm9tIF9fZnV0dXJlX18gaW1wb3J0IGFubm90YXRpb25zCgppbXBvcnQganNvbgppbXBvcnQgb3MKaW1wb3J0IHJlCmltcG9y',
    'dCBzeXMKCiMgSGFybmVzcyBjYXBzIHRoZSB0aXRsZSBhdCAyMDAgY2hhcnMgKGFuZCBzdHJpcHMgY29udHJvbCBjaGFyYWN0ZXJz',
    'KS4KTUFYX1RJVExFID0gMjAwCiMgTmV2ZXIgbGV0IHRoZSBJRCBsaXN0IGVhdCB0aGUgd2hvbGUgdGl0bGUuCk1BWF9SRUZTID0g',
    'NgojIEJvdW5kIGhvdyBtdWNoIHRyYW5zY3JpcHQgd2UgcGFyc2UsIHNvIHRoZSBob29rIHN0YXlzIGZhc3Qgb24gbG9uZyBzZXNz',
    'aW9ucy4KTUFYX1RBSUxfQllURVMgPSA4ICogMTAyNCAqIDEwMjQKCiMgVGhlIGZvdW5kZXIncyBwcm94eSBzZXNzaW9uIChzdGFy',
    'dGVkIHdpdGggL2NoaWVmLW9mLXN0YWZmKSBrZWVwcyB0aGlzIGV4YWN0IHRpdGxlLgpQUk9YWV9USVRMRSA9ICJDaGllZiBvZiBT',
    'dGFmZiIKIyBUaGUgc3RhcnQgY29tbWFuZCBzaXRzIGF0IHRoZSB2ZXJ5IHRvcCBvZiB0aGUgdHJhbnNjcmlwdDsgdGhlIHRhaWwg',
    'd2luZG93IGNhbgojIG1pc3MgaXQgb24gYSBsb25nIHNlc3Npb24sIHNvIGxvb2sgYXQgdGhlIGhlYWQgaW5zdGVhZC4KSEVBRF9C',
    'WVRFUyA9IDY0ICogMTAyNAojIEV4YWN0IGNsb3NpbmcgdGFnOiAvY2hpZWYtb2Ytc3RhZmYtcnVubmVyWy1saWdodF0gc2hhcmUg',
    'dGhlIHByZWZpeCwgbm90IHRoZSB0YWcuClBST1hZX0NNRCA9ICI8Y29tbWFuZC1uYW1lPi9jaGllZi1vZi1zdGFmZjwvY29tbWFu',
    'ZC1uYW1lPiIKClNFUEFSQVRPUiA9ICIg4oCUICIKCiMgQXBwcm92YWJsZXM6IFNQRUMtTk5OIC8gRFItTk5OIC8gRVAtTk5OLCBh',
    'bmQgR2l0SHViIGlzc3Vlcy9QUnMgYXMgI05OTi4KIyBEUi0wNTMgdjIgY3Jvc3MtcHJvamVjdCBmb3JtcyAoTUlOL1NQMTkpIGFy',
    'ZSBtYXRjaGVkIHRvbyBhbmQga2VwdCB2ZXJiYXRpbS4KUkVGX1JFID0gcmUuY29tcGlsZSgKICAgIHIiXGIoPzpbQS1aXXszfS8p',
    'Pyg/OlNQRUN8RFJ8RVApLVxkK1xiIgogICAgciJ8XGIoPzpbQS1aXXszfS8pPyg/OlNQfERSfEVQfFBSfElTKVxkK1xiIgogICAg',
    'ciJ8KD88IVtcdy9dKSNcZCtcYiIKKQoKIyBBIHRyYWlsaW5nIHJ1biBvZiByZWZzIHdlIGFwcGVuZGVkIG9uIGFuIGVhcmxpZXIg',
    'dHVybiDigJQgc3RyaXBwZWQgYmVmb3JlCiMgcmUtYXBwZW5kaW5nLCBzbyB0aGUgdGl0bGUgbmV2ZXIgZ3Jvd3MgInRpdGxlIOKA',
    'lCBEUi0wNzEg4oCUIERSLTA3MSAjMTA4MiIuClRBSUxfUkVGU19SRSA9IHJlLmNvbXBpbGUoCiAgICByIlxzK+KAlFxzKyg/Oig/',
    'OltBLVpdezN9Lyk/KD86U1BFQ3xEUnxFUCktXGQrfCg/OltBLVpdezN9Lyk/KD86U1B8RFJ8RVB8UFJ8SVMpXGQrfCNcZCspIgog',
    'ICAgciIoPzpccysoPzooPzpbQS1aXXszfS8pPyg/OlNQRUN8RFJ8RVApLVxkK3woPzpbQS1aXXszfS8pPyg/OlNQfERSfEVQfFBS',
    'fElTKVxkK3wjXGQrKSkqXHMqJCIKKQoKCmRlZiByZWFkX3RhaWwocGF0aDogc3RyKSAtPiBsaXN0W3N0cl06CiAgICAiIiJSZXR1',
    'cm4gdGhlIHRyYW5zY3JpcHQncyBsaW5lcywgYm91bmRlZCB0byB0aGUgbGFzdCBNQVhfVEFJTF9CWVRFUy4iIiIKICAgIHNpemUg',
    'PSBvcy5wYXRoLmdldHNpemUocGF0aCkKICAgIHdpdGggb3BlbihwYXRoLCAicmIiKSBhcyBmaDoKICAgICAgICBpZiBzaXplID4g',
    'TUFYX1RBSUxfQllURVM6CiAgICAgICAgICAgIGZoLnNlZWsoc2l6ZSAtIE1BWF9UQUlMX0JZVEVTKQogICAgICAgICAgICBmaC5y',
    'ZWFkbGluZSgpICAjIGRyb3AgdGhlIHBhcnRpYWwgbGluZSB3ZSBsYW5kZWQgaW4gdGhlIG1pZGRsZSBvZgogICAgICAgIGRhdGEg',
    'PSBmaC5yZWFkKCkKICAgIHJldHVybiBkYXRhLmRlY29kZSgidXRmLTgiLCAicmVwbGFjZSIpLnNwbGl0bGluZXMoKQoKCmRlZiBp',
    'c19wcm94eV9zZXNzaW9uKHBhdGg6IHN0cikgLT4gYm9vbDoKICAgICIiIlRydWUgd2hlbiB0aGUgdHJhbnNjcmlwdCdzIG9wZW5p',
    'bmcgdXNlciBlbnRyaWVzIGNhcnJ5IHRoZSBleGFjdAogICAgL2NoaWVmLW9mLXN0YWZmIGNvbW1hbmQgKG5vdCAvY2hpZWYtb2Yt',
    'c3RhZmYtcnVubmVyKikuIiIiCiAgICB3aXRoIG9wZW4ocGF0aCwgInJiIikgYXMgZmg6CiAgICAgICAgZGF0YSA9IGZoLnJlYWQo',
    'SEVBRF9CWVRFUykKICAgIGxpbmVzID0gZGF0YS5kZWNvZGUoInV0Zi04IiwgInJlcGxhY2UiKS5zcGxpdGxpbmVzKClbOi0xXSAg',
    'IyBsYXN0IG1heSBiZSBjdXQKICAgIHNlZW4gPSAwCiAgICBmb3IgbGluZSBpbiBsaW5lczoKICAgICAgICBpZiAnInR5cGUiOiJ1',
    'c2VyIicgbm90IGluIGxpbmUgYW5kICcidHlwZSI6ICJ1c2VyIicgbm90IGluIGxpbmU6CiAgICAgICAgICAgIGNvbnRpbnVlCiAg',
    'ICAgICAgdHJ5OgogICAgICAgICAgICBlbnRyeSA9IGpzb24ubG9hZHMobGluZSkKICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgog',
    'ICAgICAgICAgICBjb250aW51ZQogICAgICAgIGlmIGVudHJ5LmdldCgidHlwZSIpICE9ICJ1c2VyIjoKICAgICAgICAgICAgY29u',
    'dGludWUKICAgICAgICBjb250ZW50ID0gKGVudHJ5LmdldCgibWVzc2FnZSIpIG9yIHt9KS5nZXQoImNvbnRlbnQiKQogICAgICAg',
    'IGlmIG5vdCBpc2luc3RhbmNlKGNvbnRlbnQsIHN0cik6CiAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgaWYgY29udGVudC5s',
    'c3RyaXAoKS5zdGFydHN3aXRoKCI8Y29tbWFuZC1tZXNzYWdlPiIpIG9yIGNvbnRlbnQubHN0cmlwKCkuc3RhcnRzd2l0aCgiPGNv',
    'bW1hbmQtbmFtZT4iKToKICAgICAgICAgICAgaWYgUFJPWFlfQ01EIGluIGNvbnRlbnQ6CiAgICAgICAgICAgICAgICByZXR1cm4g',
    'VHJ1ZQogICAgICAgIHNlZW4gKz0gMQogICAgICAgIGlmIHNlZW4gPj0gNTogICMgdGhlIHN0YXJ0IGNvbW1hbmQgaXMgYW1vbmcg',
    'dGhlIGZpcnN0IGZldyB1c2VyIGVudHJpZXMKICAgICAgICAgICAgYnJlYWsKICAgIHJldHVybiBGYWxzZQoKCmRlZiB1c2VyX3By',
    'b21wdHMobGluZXM6IGxpc3Rbc3RyXSkgLT4gbGlzdFtzdHJdOgogICAgIiIiVHlwZWQgdXNlciBwcm9tcHRzLCBvbGRlc3QgZmly',
    'c3QuCgogICAgT25seSBgdHlwZTogInVzZXIiYCBlbnRyaWVzIHdob3NlIGNvbnRlbnQgaXMgYSBwbGFpbiBzdHJpbmcgYXJlIHJl',
    'YWwgdHlwZWQKICAgIHByb21wdHMg4oCUIHRvb2wgcmVzdWx0cyBhcnJpdmUgYXMgY29udGVudCAqYXJyYXlzKiwgYW5kIG1ldGEg',
    'ZW50cmllcyBjYXJyeQogICAgaG9vayBvdXRwdXQsIGNvbW1hbmQgd3JhcHBlcnMsIGFuZCBzeXN0ZW0gcmVtaW5kZXJzLgogICAg',
    'IiIiCiAgICBvdXQ6IGxpc3Rbc3RyXSA9IFtdCiAgICBmb3IgbGluZSBpbiBsaW5lczoKICAgICAgICBpZiAnInR5cGUiOiJ1c2Vy',
    'Iicgbm90IGluIGxpbmUgYW5kICcidHlwZSI6ICJ1c2VyIicgbm90IGluIGxpbmU6CiAgICAgICAgICAgIGNvbnRpbnVlCiAgICAg',
    'ICAgdHJ5OgogICAgICAgICAgICBlbnRyeSA9IGpzb24ubG9hZHMobGluZSkKICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAg',
    'ICAgICAgICBjb250aW51ZQogICAgICAgIGlmIGVudHJ5LmdldCgidHlwZSIpICE9ICJ1c2VyIiBvciBlbnRyeS5nZXQoImlzTWV0',
    'YSIpOgogICAgICAgICAgICBjb250aW51ZQogICAgICAgIGNvbnRlbnQgPSAoZW50cnkuZ2V0KCJtZXNzYWdlIikgb3Ige30pLmdl',
    'dCgiY29udGVudCIpCiAgICAgICAgaWYgbm90IGlzaW5zdGFuY2UoY29udGVudCwgc3RyKSBvciBub3QgY29udGVudC5zdHJpcCgp',
    'OgogICAgICAgICAgICBjb250aW51ZQogICAgICAgIGlmIGNvbnRlbnQubHN0cmlwKCkuc3RhcnRzd2l0aCgoIjxjb21tYW5kLW5h',
    'bWU+IiwgIjxsb2NhbC1jb21tYW5kIiwgIjx1c2VyLW1lbW9yeSIpKToKICAgICAgICAgICAgY29udGludWUKICAgICAgICBvdXQu',
    'YXBwZW5kKGNvbnRlbnQpCiAgICByZXR1cm4gb3V0CgoKZGVmIGxhc3RfYWlfdGl0bGUobGluZXM6IGxpc3Rbc3RyXSkgLT4gc3Ry',
    'OgogICAgIiIiQ2xhdWRlIENvZGUncyBvd24gcm9sbGluZyBhdXRvLXN1bW1hcnkg4oCUIGl0IGtlZXBzIHVwZGF0aW5nIGV2ZW4g',
    'b25jZSBhCiAgICBjdXN0b20gdGl0bGUgaXMgc2V0LCBzbyBpdCBzdGF5cyBhIGxpdmUgYmFzZSB0byBhcHBlbmQgdG8uIiIiCiAg',
    'ICBiYXNlID0gIiIKICAgIGZvciBsaW5lIGluIGxpbmVzOgogICAgICAgIGlmICciYWktdGl0bGUiJyBpbiBsaW5lOgogICAgICAg',
    'ICAgICB0cnk6CiAgICAgICAgICAgICAgICBlbnRyeSA9IGpzb24ubG9hZHMobGluZSkKICAgICAgICAgICAgZXhjZXB0IEV4Y2Vw',
    'dGlvbjoKICAgICAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgICAgIGlmIGVudHJ5LmdldCgidHlwZSIpID09ICJhaS10aXRs',
    'ZSIgYW5kIGVudHJ5LmdldCgiYWlUaXRsZSIpOgogICAgICAgICAgICAgICAgYmFzZSA9IHN0cihlbnRyeVsiYWlUaXRsZSJdKQog',
    'ICAgICAgIGVsaWYgJyJjdXN0b20tdGl0bGUiJyBpbiBsaW5lIGFuZCBub3QgYmFzZToKICAgICAgICAgICAgdHJ5OgogICAgICAg',
    'ICAgICAgICAgZW50cnkgPSBqc29uLmxvYWRzKGxpbmUpCiAgICAgICAgICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgICAg',
    'ICAgICBjb250aW51ZQogICAgICAgICAgICBpZiBlbnRyeS5nZXQoInR5cGUiKSA9PSAiY3VzdG9tLXRpdGxlIiBhbmQgZW50cnku',
    'Z2V0KCJjdXN0b21UaXRsZSIpOgogICAgICAgICAgICAgICAgYmFzZSA9IFRBSUxfUkVGU19SRS5zdWIoIiIsIHN0cihlbnRyeVsi',
    'Y3VzdG9tVGl0bGUiXSkpCiAgICByZXR1cm4gYmFzZS5zdHJpcCgpCgoKZGVmIGNvbGxlY3RfcmVmcyhwcm9tcHRzOiBsaXN0W3N0',
    'cl0pIC0+IGxpc3Rbc3RyXToKICAgICIiIkRlZHVwZWQgYXBwcm92YWJsZSBJRHMsIG1vc3QtcmVjZW50bHktbWVudGlvbmVkIGZp',
    'cnN0LiIiIgogICAgc2VlbjogZGljdFtzdHIsIE5vbmVdID0ge30KICAgIGZvciB0ZXh0IGluIHJldmVyc2VkKHByb21wdHMpOiAg',
    'IyBuZXdlc3QgcHJvbXB0IGZpcnN0CiAgICAgICAgZm9yIHJlZiBpbiBSRUZfUkUuZmluZGFsbCh0ZXh0KToKICAgICAgICAgICAg',
    'c2Vlbi5zZXRkZWZhdWx0KHJlZiwgTm9uZSkKICAgICAgICAgICAgaWYgbGVuKHNlZW4pID49IE1BWF9SRUZTOgogICAgICAgICAg',
    'ICAgICAgcmV0dXJuIGxpc3Qoc2VlbikKICAgIHJldHVybiBsaXN0KHNlZW4pCgoKZGVmIGNvbXBvc2UoYmFzZTogc3RyLCByZWZz',
    'OiBsaXN0W3N0cl0pIC0+IHN0cjoKICAgIHRhaWwgPSAiICIuam9pbihyZWZzKQogICAgaWYgbm90IGJhc2U6CiAgICAgICAgcmV0',
    'dXJuIHRhaWxbOk1BWF9USVRMRV0KICAgIHJvb20gPSBNQVhfVElUTEUgLSBsZW4oU0VQQVJBVE9SKSAtIGxlbih0YWlsKQogICAg',
    'aWYgcm9vbSA8IDEyOiAgIyByZWZzIGFsb25lIGFyZSBhbHJlYWR5IG5lYXIgdGhlIGNhcCDigJQgZHJvcCB0aGUgc3VtbWFyeQog',
    'ICAgICAgIHJldHVybiB0YWlsWzpNQVhfVElUTEVdCiAgICBpZiBsZW4oYmFzZSkgPiByb29tOgogICAgICAgIGJhc2UgPSBiYXNl',
    'Wzogcm9vbSAtIDFdLnJzdHJpcCgpICsgIuKApiIKICAgIHJldHVybiBmIntiYXNlfXtTRVBBUkFUT1J9e3RhaWx9IgoKCmRlZiBt',
    'YWluKCkgLT4gaW50OgogICAgdHJ5OgogICAgICAgIGVudmVsb3BlID0ganNvbi5sb2FkKHN5cy5zdGRpbikKICAgIGV4Y2VwdCBF',
    'eGNlcHRpb246CiAgICAgICAgcmV0dXJuIDAKCiAgICBwcm9tcHRzOiBsaXN0W3N0cl0gPSBbXQogICAgdHJhbnNjcmlwdCA9IGVu',
    'dmVsb3BlLmdldCgidHJhbnNjcmlwdF9wYXRoIikKICAgIGlmIHRyYW5zY3JpcHQgYW5kIG9zLnBhdGguaXNmaWxlKHRyYW5zY3Jp',
    'cHQpOgogICAgICAgIHRyeToKICAgICAgICAgICAgcHJveHkgPSBpc19wcm94eV9zZXNzaW9uKHRyYW5zY3JpcHQpCiAgICAgICAg',
    'ZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICAgICAgcHJveHkgPSBGYWxzZQogICAgICAgIGlmIHByb3h5OgogICAgICAgICAgICBq',
    'c29uLmR1bXAoCiAgICAgICAgICAgICAgICB7CiAgICAgICAgICAgICAgICAgICAgImhvb2tTcGVjaWZpY091dHB1dCI6IHsKICAg',
    'ICAgICAgICAgICAgICAgICAgICAgImhvb2tFdmVudE5hbWUiOiAiVXNlclByb21wdFN1Ym1pdCIsCiAgICAgICAgICAgICAgICAg',
    'ICAgICAgICJzZXNzaW9uVGl0bGUiOiBQUk9YWV9USVRMRSwKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9',
    'LAogICAgICAgICAgICAgICAgc3lzLnN0ZG91dCwKICAgICAgICAgICAgKQogICAgICAgICAgICByZXR1cm4gMAogICAgaWYgdHJh',
    'bnNjcmlwdCBhbmQgb3MucGF0aC5pc2ZpbGUodHJhbnNjcmlwdCk6CiAgICAgICAgdHJ5OgogICAgICAgICAgICBsaW5lcyA9IHJl',
    'YWRfdGFpbCh0cmFuc2NyaXB0KQogICAgICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgICAgIGxpbmVzID0gW10KICAgIGVs',
    'c2U6CiAgICAgICAgbGluZXMgPSBbXQoKICAgIHByb21wdHMuZXh0ZW5kKHVzZXJfcHJvbXB0cyhsaW5lcykpCiAgICBjdXJyZW50',
    'ID0gZW52ZWxvcGUuZ2V0KCJwcm9tcHQiKQogICAgaWYgaXNpbnN0YW5jZShjdXJyZW50LCBzdHIpIGFuZCBjdXJyZW50LnN0cmlw',
    'KCk6CiAgICAgICAgcHJvbXB0cy5hcHBlbmQoY3VycmVudCkKCiAgICByZWZzID0gY29sbGVjdF9yZWZzKHByb21wdHMpCiAgICBp',
    'ZiBub3QgcmVmczoKICAgICAgICByZXR1cm4gMCAgIyBub3RoaW5nIHRvIGFwcGVuZCDigJQgbGVhdmUgQ2xhdWRlIENvZGUncyBv',
    'd24gdGl0bGUgYWxvbmUKCiAgICB0aXRsZSA9IGNvbXBvc2UobGFzdF9haV90aXRsZShsaW5lcyksIHJlZnMpCiAgICBqc29uLmR1',
    'bXAoCiAgICAgICAgewogICAgICAgICAgICAiaG9va1NwZWNpZmljT3V0cHV0IjogewogICAgICAgICAgICAgICAgImhvb2tFdmVu',
    'dE5hbWUiOiAiVXNlclByb21wdFN1Ym1pdCIsCiAgICAgICAgICAgICAgICAic2Vzc2lvblRpdGxlIjogdGl0bGUsCiAgICAgICAg',
    'ICAgIH0KICAgICAgICB9LAogICAgICAgIHN5cy5zdGRvdXQsCiAgICApCiAgICByZXR1cm4gMAoKCmlmIF9fbmFtZV9fID09ICJf',
    'X21haW5fXyI6CiAgICB0cnk6CiAgICAgICAgc3lzLmV4aXQobWFpbigpKQogICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICBz',
    'eXMuZXhpdCgwKSAgIyBjb3NtZXRpYyBob29rIOKAlCBuZXZlciBibG9jayBhIHR1cm4K',
  ].join(''),
);

