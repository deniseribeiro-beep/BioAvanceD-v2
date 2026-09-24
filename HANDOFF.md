# HANDOFF

**Written 2026-09-24, fifty-fifth queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.**

The instruction was "Read handoff. Pick next group of issues to resolve.
Docker is on. No parallel session ongoing, but checking pc usage is good
practice with heavy loads." The group picked was the policies item the last
note recommended, **#1139**, plus **#1198**, which #1139's work surfaced.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit
is `85dcdd17` (#1198).

## What shipped

- **#1139**, `167fb3cd`, closed with a comment. The policy API has no
  translation layer any more: request and response are the stored
  `temperaturePolicies` document (`name`, `minTemp`, `maxTemp`, `targetTemp`,
  `hysteresis`, `minimumDuration`, `temperatureUnit`, `effectivePeriod
  {start,end}`). `models/Policy.js` is deleted. The PUT allowlist is a list
  again.
- **#1198**, `85dcdd17`, closed with a comment. Policies are Celsius only
  (POST and PUT 422 on anything else, and the form shows a fixed °C).
  `checkPolicyAndAlert` converts a °F or K reading to °C before comparing.
- **e2e:** `temperature-policies-ui.spec.ts` plus `sensor-registration.spec.ts`,
  7 passed and 0 skipped, `[ran it]` on a fresh `--build` stack. This was a
  per-spec run, not the full gate.

## Filed this sitting

- **#1197**, open, label `question`: the dictionary amendment request for
  `targetTemp`, which has no dict-02 ThresholdProfile row. The dictionary is
  Denise's document, so the remedy is hers.
- Two findings about the tooling itself, filed in Dennis's private tracker
  for tooling, not here.

## Touched, not closed

None. #1196, #1181, #793, #1192, #1193 and #941 are unchanged by this sitting.

## Still waiting on Dennis

#1196's default, and now #1197 (for Denise). For the rest, query `gh issue
list --state open --label question` and read each issue's last comment.

## Docker and the machine

- **Gate:** Dennis, 2026-09-24: "Docker is on. No parallel session ongoing."
  It closes at the next `/clear`. RAM at the start was 5.7 of 15.8 GB free.
- **Our test stack is down.** `compose down` without `-v`, so its named
  volumes survive. They hold this sitting's policy/sensor fixtures, and the
  admin bootstrap has run against them. Images are built from `85dcdd17`.
- Port 8086 was outside every reserved range on 2026-09-24 (`netsh ...
  excludedportrange`). Derive it again before relying on it.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **The policy API speaks the stored names.** Never reintroduce a
  legacy-name mapping (`minThreshold`, `policyName`, `validFrom`,
  `alertDelayMin`) at the boundary. The `#1139` block in
  `policy.routes.test.js` pins this.
- **Policy limits are Celsius.** A reading in another unit is converted for
  the comparison and stored as recorded (RF009 AC#7).

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-24: `stabilize/v2.0.0-prototype`
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-24: 904 commits on hers only, 123 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`).
- Her tip's CI, 2026-09-24 18:52: current-state validation passed. Full
  Vitest diagnostic, Coverage diagnostic and release manifest integrity
  failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued: Dennis named no next item. The branch is not gate-green for the
full suite since `5fc5c843`. The per-spec runs above are all this sitting
ran. Dennis's go is still needed for a PR into `main`.
