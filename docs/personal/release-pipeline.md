# Release runbook: personal T3 Code

How this fork ships: sync upstream, build and deploy the desktop app to every Mac, build and
submit the mobile apps. Originally ported 2026-07-25 from the archived planning repo
[r4iju/t3-code](https://github.com/r4iju/t3-code); historical decision links point there.

**The fork ships upstream's app; we ship the pipeline.** The delta stays env/config-only plus
additive files (`docs/personal/`, `scripts/personal/`). Upstream files are edited only when
unavoidable. Before each release, review the exit-path register in
[contributing-upstream.md](./contributing-upstream.md): every feature delta must be moving
toward upstream or have a written reason to stay.

## Machines

| Machine                  | SSH                      | Role                                               |
| ------------------------ | ------------------------ | -------------------------------------------------- |
| studio (Mac Studio)      | —                        | Builds and signs releases; T3 Code host            |
| matebook                 | `emanuel@matebook.lan`   | T3 Code host                                       |
| sm-em (work MacBook Pro) | `emanuelfranzen@Mac.lan` | T3 Code host                                       |
| iPhone / Android         | —                        | Mobile clients: TestFlight / Play internal testing |

Every Mac runs "T3 Code (Alpha)" from `/Applications`, built from this fork. A LAN server is
the desktop app with Settings → Connections → Network access on (`0.0.0.0:3773`, pairing QR).
Pairing tokens expire in ~5 minutes; mint one right before pairing (`t3 auth pairing create`).

## 1. Sync upstream

Direct pushes to `main` are blocked, so a sync is a PR:

```bash
git -C ~/code/t3code fetch upstream
git -C ~/code/t3code worktree add ~/code/t3code-wt-sync -b sync/upstream-$(date +%Y%m%d) origin/main
cd ~/code/t3code-wt-sync && git merge upstream/main && vp i
git push -u origin HEAD && gh pr create --fill && gh pr merge --merge
git -C ~/code/t3code pull --ff-only
git -C ~/code/t3code worktree remove ~/code/t3code-wt-sync
```

`gh` resolves to `origin` (`remote.origin.gh-resolved base`); upstream PRs need an explicit
`--repo pingdotgg/t3code`.

## 2. Desktop: build, sign, deploy

On studio, from a clean `~/code/t3code` on `main`:

```bash
scripts/personal/t3-alpha-build 0.0.47
scripts/personal/t3-alpha-deploy release/T3-Code-0.0.47-arm64.zip
```

- **Version:** the next patch after the last deploy. Every package.json is set to it for the
  build and restored afterwards, so the app and its server report the same version.
- **Signing:** the build is signed with the Apple Development certificate in studio's keychain.
  macOS privacy grants (Screen Recording, Accessibility, …), keychain access and Little Snitch
  rules are tied to that signature, so they carry over between builds. An unsigned build is a
  new app to all of them; the installer refuses one.
- **Deploy:** copies the zip and installer to matebook and sm-em over SSH, installs, and waits
  for each result. Studio goes last because its restart ends any T3 session driving the
  deploy. Name hosts to deploy to a subset: `… .zip emanuel@matebook.lan local`.
- **Target Macs must be logged in:** the installer launches the app in the GUI session.
- **Failures roll back** to the previous bundle automatically. Each Mac logs to
  `~/Library/Logs/t3-alpha-install.log`; `scripts/personal/t3-alpha-install --status` shows
  what runs, `--restart` relaunches. Only the latest `.bak-*` bundle is kept.

## 3. Mobile: build and submit

Identity is the fork's own (`com.raijustudios.t3code`, Apple team `C7X9BCC7LP`, EAS project
`@expomozdom/t3-code`); upstream's `com.t3tools.t3code.*` IDs stay untouched. The identity env
vars live in EAS (production and preview):

```
T3CODE_EAS_OWNER=expomozdom
T3CODE_EAS_PROJECT_ID=041ec0cd-429a-40d9-8d00-9fcf196ebb59
T3CODE_ANDROID_PACKAGE=com.raijustudios.t3code
T3CODE_IOS_PERSONAL_TEAM=1
T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=com.raijustudios.t3code
```

From `apps/mobile`, logged in to EAS as `expomozdom`:

```bash
eas build --profile production -p ios --non-interactive --no-wait
eas build --profile production -p android --non-interactive --no-wait
eas submit -p ios --latest --profile personal      # → TestFlight internal
eas submit -p android --latest --profile personal  # → Play internal testing
```

- EAS cloud builds by default; `eas build --local` is the fallback (Xcode 26.1+, JDK 17 +
  `ANDROID_HOME`).
- Credentials are EAS-managed. Submit credentials (ASC API key, Play service account) live in
  the gitignored `apps/mobile/credentials/`.
- Version follows upstream's app version; build numbers auto-increment remotely.
- Do not dispatch `.github/workflows/mobile-eas-production.yml` on the fork: it has no
  `EXPO_TOKEN` secret and silently no-ops.
- T3 Connect env vars stay unset: LAN-only scope.

## One-time setup

- **Signing certificate** (studio): "Apple Development: Emanuel Franzen (T4J48V44Q2)" in the
  login keychain; allow `codesign` access once. A renewed certificate keeps its name, so grants
  survive renewal. Signing with another identity (`T3_ALPHA_SIGN_IDENTITY`, for example a
  Developer ID) makes every Mac re-grant permissions once. To build on another Mac, export the
  certificate with its key as `.p12` and import it there.
- **First signed install on a Mac:** grant macOS permissions and Little Snitch rules once more;
  they stick from then on.
- **SSH:** studio needs key-based SSH to every deploy target.
