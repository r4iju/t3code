# Contributing upstream & keeping this fork thin

Companion to [release-pipeline.md](./release-pipeline.md). That doc says how we ship; this one
says how we push changes back to `pingdotgg/t3code` — and why every feature we add here must
have an exit path.

## The problem this doc exists to prevent

The fork's founding principle was **env/config-only delta** (release-pipeline.md, 2026-07-23).
We have already broken it twice: terminal link chips (#6) and Android selectable prose (#7) are
feature deltas. Each one makes upstream merges harder, each future upstream refactor of
`ThreadFeed.tsx` or the terminal is now a potential conflict, and a fork that quietly accumulates
private features it never upstreams is a slop-fork on a timer. The rule going forward:

> **Every feature delta lands with an exit path: an upstream issue/PR, a library PR, or a
> written decision that it stays fork-only (and why). No exit path, no merge.**

## What upstream accepts (their CONTRIBUTING.md, read it before every PR)

- They are **not actively accepting contributions**; unvouched PRs may be closed or ignored.
- Most likely accepted: **small, focused bug fixes; reliability fixes; small performance
  improvements; tightly scoped maintenance**.
- Least likely: large PRs, drive-by features, scope expansion. 1,000+ line PRs get closed
  and remembered.
- **Issue first** for anything non-trivial. Before/after images for UI changes; short video
  for interaction/timing changes.
- PRs are auto-labeled `vouch:*` and `size:*`. We are `vouch:unvouched` until proven
  otherwise — consistent small, high-quality fixes are the only route to vouched status.

## Our niche: what we can credibly offer

We are one of the few parties running the **mobile app on Android daily** against real
workloads. Upstream's mobile effort is visibly iOS-first (the native selectable-markdown view
excludes Android by design). That makes our lane:

1. **Android-specific bug reports** with emulator repro steps and screenshots — cheap for us
   (the `test-t3-mobile` flow produces them as a byproduct), valuable for them.
2. **Small Android parity fixes** in the fallback rendering paths.
3. **Library-level fixes** upstreamed to the dependencies t3code uses (see the selectable
   case below) — these help upstream without touching their tree at all.
4. LAN-only / self-hosted usage reports — we exercise the direct-LAN path they rarely do.

What we should not send: features tied to our personal pipeline, opinionated UX changes,
anything `size:L` or larger.

## Mechanics of an upstream PR

- Branch from **`upstream/main`**, never from our `main` — our main contains fork deltas that
  must not leak into an upstream PR.
- `gh` now defaults to `origin` everywhere (`git config --global remote.origin.gh-resolved base`,
  set 2026-07-26 after accidentally opening pingdotgg PR #4549). Upstream PRs therefore need
  an explicit `--repo pingdotgg/t3code`. This friction is intentional.
- One change per PR, exact what/why in the description, images/video per their rules.
- File the issue first, link the fork commit as a working reference, and offer the PR — let
  them opt in.

## Exit-path register

Update this table whenever a delta is added, upstreamed, or consciously kept.

| Delta                                                          | Fork commit                              | Exit path                                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                                   |
| -------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Terminal URL link chips (mobile)                               | `434407fad` (#6), fixes `eaa6520c0` (#8) | See [playbook below](#ready-to-go-playbook-terminal-link-chips): issue first (mobile parity with `apps/web/src/terminal-links.ts`), then a trimmed PR cherry-picked from upstream/main.                                                                                                                                                                                                                                        | **Code ready** — needs device media, then file the issue |
| Android selectable message prose                               | `c5658279f` (#7)                         | Two-step: (1) PR the `selectable` prop to [react-native-nitro-markdown](https://github.com/JoaoPauloCMarra/react-native-nitro-markdown) (it already does this for code blocks; prose is a natural extension). (2) Once released, file a tiny t3code PR (~3 call-site words in `ThreadFeed.tsx`) and drop our pnpm patch on the version bump. Never send the pnpm patch upstream — that is what made closed PR #4549 `size:XL`. | **Todo** — lib PR not yet opened                         |
| EAS identity hooks, `personal` submit profile, credentials dir | #2/#3/#5                                 | None — this _is_ the fork (env/config-only by design).                                                                                                                                                                                                                                                                                                                                                                         | **Keep, fork-only**                                      |
| `docs/personal/*`                                              | —                                        | None — fork-local docs.                                                                                                                                                                                                                                                                                                                                                                                                        | **Keep, fork-only**                                      |

## Ready-to-go playbook: terminal link chips

Everything below was worked out on 2026-07-26; when we decide to contribute, this is the
whole remaining path.

**Why it has a real shot.** Upstream merged this exact problem class on web twice — #17
("terminal links") and #1913 ("Fix opening urls wrapped across lines in the terminal", from an
_unvouched_ contributor, size L). Their mobile terminal files are identical to ours pre-delta,
so the bug — claude CLI login is impossible from the phone terminal — exists for every mobile
user of theirs, in a core flow. Pitch is "mobile parity with web link handling", not a feature.

**Already done (don't redo):** pingdotgg#4549's bot review found three real extraction bugs
(adjacent URLs joined, OSC 8 recency lost, prefix dedup hiding distinct URLs) — all fixed with
regression tests in `eaa6520c0` (#8). Never send the pre-#8 version.

**Remaining prerequisite:** on-device verification media per their CONTRIBUTING — screenshots
(iOS + Android, light + dark) and a short video of `claude /login` → tap chip → browser opens.
The `test-t3-mobile` flow produces these as a byproduct.

**Then, in order:**

1. File the issue (`--repo pingdotgg/t3code`): frame as the bug, attach the video, link our
   fork commits as a working reference, and ask whether they'd prefer the chip bar or native
   Ghostty `OPEN_URL` handling (`action_cb` stub in `T3TerminalView.swift`) before sending code.
2. If they bite: branch from `upstream/main`, cherry-pick `434407fad` + `eaa6520c0`, squash to
   one commit. The diff is exactly seven files: `terminalBufferLinks.ts` + test,
   `TerminalLinkBar.tsx`, two-line wiring in `ThreadTerminalPanel.tsx` and
   `ThreadTerminalRouteScreen.tsx`, one literal in `openExternalUrl.ts`. Nothing else — the
   ride-alongs were what sank #4549.
3. PR body must state: the native alternative and why we didn't take it (GPU-rendered text, no
   native rebuild, no mouse-report side effects); the heuristic's limits (wrap-join assumes
   ≥40 cols, http(s) only, 3 chips, 16 KB scan window); that the logic mirrors
   `apps/web/src/terminal-links.ts` (offer shared-package unification as a follow-up question,
   not preemptive scope); and a candid reference to #4549 ("opened against the wrong repo,
   this is the properly scoped version with the review findings addressed").

## Slop-fork hygiene checklist

- **Sync upstream regularly** (`git fetch upstream && git merge upstream/main`), not only at
  release time. The longer the gap, the worse the `ThreadFeed.tsx` conflicts.
- **Before adding any feature delta**: could this be an env hook, a patch, or an upstream PR
  instead? Feature-in-fork is the last resort, and it enters the register above with an exit path.
- **After every upstream sync**: check whether upstream shipped their own version of one of our
  deltas (e.g. a native Android selectable view would obsolete #7 entirely) — if so, prefer
  reverting ours to keep the delta shrinking.
- **Patches expire**: every `patches/*.patch` should map to an upstream (library or t3code)
  issue/PR. A patch nobody is trying to retire is slop.
- **Review the register at each release** (it takes a minute; the release ritual in
  release-pipeline.md is the natural checkpoint).
