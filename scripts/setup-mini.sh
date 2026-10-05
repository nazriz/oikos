#!/bin/bash
# Set up a Mac as Oikos's run server: the tools, the repo, a build, and the quick tests. Run it on that machine, once
# (it's safe to run again). Needs Homebrew and Apple's command line tools (xcode-select --install) already there.
# Afterwards, by hand, because they open a browser: `gh auth login` (before this, if the repo isn't cloned yet) and
# `codex login`.
set -euo pipefail

DIR="${OIKOS_DIR:-$HOME/oikos}"
REPO="${OIKOS_REPO:-nazriz/oikos}"

command -v brew >/dev/null || { echo "Homebrew isn't installed: see https://brew.sh"; exit 1; }
xcode-select -p >/dev/null 2>&1 || { echo "Apple's command line tools aren't installed: run xcode-select --install"; exit 1; }

for tool in gh zstd rustup codex; do command -v "$tool" >/dev/null || brew install "$tool"; done
command -v bun >/dev/null || brew install oven-sh/bun/bun
rustup toolchain list | grep -q stable || rustup default stable
rustup target list --installed | grep -q wasm32-unknown-unknown || rustup target add wasm32-unknown-unknown

if [ ! -d "$DIR/.git" ]; then
  gh auth status >/dev/null 2>&1 || { echo "Sign in to GitHub first: gh auth login"; exit 1; }
  gh repo clone "$REPO" "$DIR"
fi
cd "$DIR"
git pull --ff-only
bun install
bun run kernel
bun run test:fast

echo
echo "Oikos is built in $DIR and its quick tests pass."
echo "Still to do by hand: codex login   (then: codex exec -m gpt-6.1-sol 'say ok' to check)"
echo "For the whole suite: bun run test:all"
