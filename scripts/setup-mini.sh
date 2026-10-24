#!/bin/bash
# Set up a Mac as Oikos's run server: the tools, the repo, a build, and the quick tests. Run it on that machine, once
# (it's safe to run again). Needs Homebrew and Apple's command line tools (xcode-select --install) already there.
# By hand, because they open a browser: `codex login` afterwards; and before this, if the repo isn't cloned yet, either
# `gh auth login` or a deploy key (then give the address to clone from: OIKOS_REPO_URL=git@<ssh host alias>:nazriz/oikos.git).
set -euo pipefail

DIR="${OIKOS_DIR:-$HOME/oikos}"
REPO="${OIKOS_REPO:-nazriz/oikos}"
REPO_URL="${OIKOS_REPO_URL:-}"

command -v brew >/dev/null || { echo "Homebrew isn't installed: see https://brew.sh"; exit 1; }
xcode-select -p >/dev/null 2>&1 || { echo "Apple's command line tools aren't installed: run xcode-select --install"; exit 1; }

# Homebrew doesn't link its rustup into its usual folder (it would clash with its rust), so cargo and rustc aren't found
# after installing it: look in rustup's own folder too. scripts/mini does the same; a shell opened by hand needs
# $RUSTUP_BIN on its PATH (said at the end, if it isn't).
ORIGINAL_PATH="$PATH"
RUSTUP_BIN="$(brew --prefix)/opt/rustup/bin"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$RUSTUP_BIN:$PATH"

for tool in gh zstd rustup codex; do command -v "$tool" >/dev/null || brew install "$tool"; done
command -v bun >/dev/null || brew install oven-sh/bun/bun
command -v cargo >/dev/null || { echo "rustup is installed but cargo isn't found (looked in $RUSTUP_BIN and ~/.cargo/bin)"; exit 1; }
rustup toolchain list | grep -q stable || rustup default stable
rustup target list --installed | grep -q wasm32-unknown-unknown || rustup target add wasm32-unknown-unknown

# A compile cache shared by every checkout and worktree on the machine (docs/dev-machine.md): a kernel build in a
# second worktree reuses the first one's compiled dependencies. Incremental compilation goes off with it (the cache
# can't store incremental builds). Left alone if cargo already has a wrapper configured.
command -v sccache >/dev/null || brew install sccache
CARGO_CONFIG="$HOME/.cargo/config.toml"
if ! grep -q "rustc-wrapper" "$CARGO_CONFIG" 2>/dev/null; then
  mkdir -p "$HOME/.cargo"
  if grep -qE '^\[(build|env)\]' "$CARGO_CONFIG" 2>/dev/null; then
    echo "$CARGO_CONFIG already has a [build] or [env] section: add by hand  rustc-wrapper = \"$(command -v sccache)\"  under [build] and  CARGO_INCREMENTAL = \"0\"  under [env]"
  else
    printf '%s\n' "# A shared compile cache across every checkout and worktree on this machine (docs/dev-machine.md in oikos)." \
      "# Incremental compilation is off because the cache cannot store incremental builds." \
      "[build]" "rustc-wrapper = \"$(command -v sccache)\"" "" "[env]" "CARGO_INCREMENTAL = \"0\"" >> "$CARGO_CONFIG"
  fi
fi
# The machine's slots (scripts/slots.ts) need no setup: their folder (~/.oikos/slots) is made on first use.

if [ ! -d "$DIR/.git" ]; then
  if [ -n "$REPO_URL" ]; then
    git clone "$REPO_URL" "$DIR"
  else
    gh auth status >/dev/null 2>&1 || { echo "Sign in to GitHub first (gh auth login), or set OIKOS_REPO_URL to clone with a deploy key"; exit 1; }
    gh repo clone "$REPO" "$DIR"
  fi
fi
cd "$DIR"
git pull --ff-only
bun install
# Packages outside the workspace have their own dependencies (a test there fails without them).
(cd docs/research/cel-check && bun install)
bun run kernel
# Only scripts/merge.ts pushes to main: the pre-push hook, in the repository's hooks folder (every worktree shares it).
bun scripts/merge-lock.ts install-hook
bun run test:fast

echo
echo "Oikos is built in $DIR and its quick tests pass."
echo "Still to do by hand: codex login   (then: codex exec -m gpt-6.1-sol 'say ok' to check)"
echo "For the whole suite: bun run test:all"
case ":$ORIGINAL_PATH:" in *":$RUSTUP_BIN:"*|*":$HOME/.cargo/bin:"*) ;; *)
  [ -x "$RUSTUP_BIN/cargo" ] && ! PATH="$ORIGINAL_PATH" command -v cargo >/dev/null &&
    echo "cargo isn't on your shell's PATH: add $RUSTUP_BIN to it (scripts/mini doesn't need this)" ;;
esac
