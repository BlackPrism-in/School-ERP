#!/usr/bin/env bash
# Applies every migration to a throwaway database and runs the schema smoke
# test. Safe to run repeatedly; the database is dropped and recreated.
#
#   ./scripts/db-test.sh
#   DB=my_scratch_db ./scripts/db-test.sh
set -euo pipefail

DB="${DB:-erp_schema_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Recreating $DB"
dropdb --if-exists "$DB"
createdb "$DB"

echo "==> Applying migrations"
# Suppress the idempotent "does not exist, skipping" notices from DROP ... IF EXISTS.
export PGOPTIONS='-c client_min_messages=warning'
for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '    %s\n' "$(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null
done
unset PGOPTIONS

echo "==> Running schema smoke test"
output=$(psql -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/schema_smoke.sql" 2>&1)
echo "$output" | grep -E 'NOTICE|ERROR' | sed 's/^/    /'

if echo "$output" | grep -q 'ERROR'; then
  echo "==> FAILED"
  exit 1
fi

passed=$(echo "$output" | grep -c 'ASSERTIONS PASSED' || true)
if [ "$passed" -lt 2 ]; then
  echo "==> FAILED: smoke test did not run to completion"
  exit 1
fi

echo "==> OK"
