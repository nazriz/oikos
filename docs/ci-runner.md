# The CI runner (self-hosted, on the run server)

`.github/workflows/ci.yml` runs on every push to `main` and nightly (never on a pull request: the repository is public,
and a fork's code must not run on this machine): `bun install`, `bun run kernel`, `bun run typecheck`, both tiers of
the suite. A second workflow, `.github/workflows/linux.yml`, runs the same nightly on a GitHub-hosted `ubuntu-latest`
machine with no secrets (PL-4). ci.yml runs on a self-hosted runner on the run server (the Mac mini),
labels `self-hosted`, `macOS`, `oikos-mini`, one job at a time, under the `clawd` user. Until the runner is registered,
jobs wait in the queue. The runner shares the machine's slots (docs/dev-machine.md), so CI waits its turn with everyone else.

Registering needs a token only the repo owner can create, and the agents' `gh` login is not valid here
(`gh auth status`: "the token in default is invalid"), so this is the owner's one-time setup.

## Steps (owner)

1. In GitHub: repo `nazriz/oikos` -> Settings -> Actions -> Runners -> **New self-hosted runner** -> macOS, ARM64.
   The page shows a download URL and a registration token (valid for one hour). Do not paste the token anywhere shared.
2. On the Mac mini, as `clawd`, outside the repo (the work directory is separate from the repo, in `_work`):

```
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -o runner.tar.gz -L <the download URL from the page>      # actions-runner-osx-arm64-<version>.tar.gz
tar xzf runner.tar.gz
./config.sh --url https://github.com/nazriz/oikos --token <TOKEN> \
  --name oikos-mini --labels oikos-mini --work ~/actions-runner/_work --unattended --replace
```

   (`self-hosted`, `macOS` and `ARM64` labels are added automatically; `--labels oikos-mini` adds ours.)
3. Install as a launchd service under `clawd` (no sudo; a user LaunchAgent, which runs while `clawd` is logged in, as the
   always-on Mac is):

```
cd ~/actions-runner && ./svc.sh install && ./svc.sh start && ./svc.sh status
```

   If the mini must run it with nobody logged in, that needs a LaunchDaemon and a password: ask for it then.
4. Check: the runner shows **Idle** under Settings -> Actions -> Runners. Push or open a PR and watch the Actions tab.
5. Private repo: Actions minutes on a self-hosted runner are free. Under Settings -> Actions -> General, keep "Require
   approval for outside collaborators" on: a pull request from a fork would run its code on this machine.

## Notes

- The workflow adds `~/.local/bin` (cargo), `/opt/homebrew/bin` and `~/.bun/bin` to the PATH; the launchd service has none.
- Each job checks out into `_work`, so `node_modules` and `kernel/target` start empty there: the first run is a cold build
  (sccache helps). To reuse a warm tree, run `bun scripts/worktree-warm.ts` on `_work/oikos/oikos` once.
- `scripts/merge.ts` is separate: it merges to main with the full suite locally; CI is the independent check on the push.
- Stop the runner: `cd ~/actions-runner && ./svc.sh stop`; remove: `./svc.sh uninstall`, then `./config.sh remove --token <TOKEN>`.
