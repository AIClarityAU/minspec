#!/usr/bin/env bash
# Test double for ~/.claude/scripts/gh-app-token.sh (#1355).
#
# scripts/lib/gh-bot.sh mints an App installation token before any GitHub write.
# Neither CI nor a fresh clone has the real minter or its private key, so tests
# that drive the pipeline scripts point MINSPEC_GH_APP_TOKEN_SCRIPT here.
#
# This stubs the SOURCE of the credential, exactly as those tests already stub
# `gh` itself. It is not a bypass: gh-bot.sh runs unmodified, and there is no
# branch in the shipped code that knows it is under test.
#
# Single line, no trailing prose — gh-bot.sh rejects a multi-line result, and
# that validation should be genuinely exercised rather than tiptoed around.
echo ghs_stub_installation_token
