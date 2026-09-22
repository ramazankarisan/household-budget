#!/usr/bin/env bash
#
# Secret scan over the staged set.
#
# gitleaks is a Go binary, not an npm package. The name "gitleaks" on npm is an unrelated
# 2022 package that ships no binary, so it is deliberately NOT a devDependency here.
#
# This fails rather than skips when the binary is missing. A gate that quietly passes when
# its tool is absent is worse than no gate: it reports green while checking nothing.
set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  cat >&2 <<'EOF'

gitleaks is not installed, so the secret scan cannot run.

  macOS:  brew install gitleaks
  other:  https://github.com/gitleaks/gitleaks/releases

To commit once without it (use sparingly):  LEFTHOOK_EXCLUDE=gitleaks git commit ...

EOF
  exit 1
fi

# v8.19.0 deprecated `protect` in favour of `git`, but kept it as a hidden command. Pick
# whichever this installation actually supports rather than pinning to one and breaking on
# either older or newer binaries.
if gitleaks git --help 2>&1 | grep -q -- '--staged'; then
  exec gitleaks git --staged --redact --no-banner
fi

exec gitleaks protect --staged --redact --no-banner
