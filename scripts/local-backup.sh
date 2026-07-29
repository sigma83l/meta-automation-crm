#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/local-backup.sh /existing/private/directory/backup.dump" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
target="$1"
parent="$(cd "$(dirname "$target")" && pwd -P)"
resolved_target="$parent/$(basename "$target")"

case "$resolved_target" in
  "$repo_root"/*)
    echo "Refusing to place a database backup inside the repository." >&2
    exit 2
    ;;
esac
if [[ -e "$resolved_target" ]]; then
  echo "Refusing to overwrite an existing backup." >&2
  exit 2
fi

pnpm exec supabase db dump --local --data-only --file "$resolved_target"
chmod 600 "$resolved_target"
shasum -a 256 "$resolved_target"
