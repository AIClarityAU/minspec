#!/usr/bin/env bash
# python-coverage.sh — measure the Python hook suites, INCLUDING code that the
# tests only reach through a subprocess (#1256).
#
# test_spec_gate.py runs spec-gate.py as a subprocess; single-process coverage
# sees 0% of it. COVERAGE_PROCESS_START tells the test helper to launch the gate
# under `coverage run --parallel-mode`; the per-process data files are then
# combined before reporting.
#
# Requires coverage.py (`pip install coverage`). A missing module fails loudly
# here rather than surfacing as every Testing-panel test "errored" (the
# ms-python adapter imports coverage unguarded when COVERAGE_ENABLED is set).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! python3 -c 'import coverage' 2>/dev/null; then
  echo "python-coverage: coverage.py is not installed." >&2
  echo "  install: pip install --no-cache-dir --break-system-packages coverage" >&2
  exit 1
fi

RC="$ROOT/scripts/hooks/.coveragerc"
export COVERAGE_PROCESS_START="$RC"
export COVERAGE_FILE="$ROOT/.coverage"

python3 -m coverage erase --rcfile="$RC"
python3 -m coverage run --rcfile="$RC" -m unittest discover -s scripts/hooks -p 'test_*.py'
python3 -m coverage combine --rcfile="$RC" --quiet
python3 -m coverage report --rcfile="$RC" --include='scripts/hooks/*'
