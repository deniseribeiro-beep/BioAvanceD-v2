# Showcase stack on a self-deleting spot VM (#1565)

`scripts/gcp-spot-showcase/run-from-pc.sh` runs from Git Bash on a Windows PC
with the operator's own gcloud and gh logins. It brings the showcase stack
(`compose.test.yml` with `compose.test.images.yml`, the images #1563
publishes) up on a spot VM, checks the API and the frontend answer, optionally
records the showcase reel (#1564) as mp4, copies the VM's output back and
deletes everything it made.

## What it leaves behind

Nothing. The EXIT trap deletes, by the exact names this run generated:

- the VM `bioavanced-cd-<first 8 of the tag>-<UTC timestamp>`;
- the firewall rule `bioavanced-cd-net-<same suffix>-ssh`, the subnet and the
  network `bioavanced-cd-net-<same suffix>`.

It never lists-then-deletes and never touches a VM or network it did not
make. It then lists instances labelled `owner=bioavanced-cd` and every
network and firewall rule named `bioavanced-cd-net-*`, and exits 9 if any is
left. If the PC dies mid-run, GCP still deletes the VM at
`--max-run-duration`; the network (which costs nothing) then stays until it
is deleted by hand.

Once the clean-up starts, Ctrl-C is ignored until it finishes, so a second
Ctrl-C cannot cut the deletes or the final list short. When the VM's metadata
check fails, the clean-up deletes the VM without trying to copy its logs back:
an scp before that check could write this PC's key into the project-wide
metadata (see SSH keys).

After any run,

    gcloud.cmd compute instances list --project=<project> --filter=labels.owner=bioavanced-cd

prints nothing.

## Network

The VM never joins the project's `default` network. The run makes its own
custom network with one subnet (`10.201.0.0/24`) and one ingress rule:
tcp:22 from this PC's public IPv4 /32 (read from `https://api.ipify.org`). No
other port is opened; the app's ports stay on the VM's loopback. The VM keeps
an ephemeral external IP for SSH and the image pulls. The rule, the subnet and
the network are deleted with the VM.

## Prerequisites

- gcloud installed for the user (`%LOCALAPPDATA%\Google\Cloud SDK`) and
  logged in (`gcloud.cmd auth login`).
- A token that can pull the private images. The recommended way is a token
  file: a classic token with only `read:packages` and a short expiry, made at
  github.com/settings/tokens and saved in a file of its own, passed as
  `--ghcr-token-file=<path>` (a `C:/...` path works; it is read on the PC only
  and never passed to gcloud). Without it, the token comes from `gh auth
  token`, so `gh` must be logged in with the `read:packages` scope (`gh auth
  refresh -s read:packages`).
- The image tag's commit fetched into this clone, and its images published
  by publish-images.yml, which keeps the newest 5.
- `curl` and `node` on PATH.

## Example

    bash scripts/gcp-spot-showcase/run-from-pc.sh \
      --project=<project> --zone=<zone> --machine-type=<type> \
      --image-tag=<40-char sha> --max-hours=<1-12> \
      --ghcr-user=<github login> --out=<local dir> [--disk-gb=<30-500>] \
      [--ghcr-token-file=<path>] [--showcase] [--dry-run]

The repo's default target project is `fundamental-run-494721-e2`; the project
is always an argument, never a default in the script. `--dry-run` prints every
external call and runs none. The VM's output lands in `<out>/vm-out/out/`
(`on-vm.log`, `up.txt`, `oneshots.txt`, `smoke.txt`, `compose-test.log`, and
with `--showcase` the `mp4/` folder).

## Exit codes

`run-from-pc.sh`:

| code | meaning |
|---|---|
| 0 | done, nothing left |
| 2 | a bad argument |
| 3 | preflight: a tool missing, a leftover `owner=bioavanced-cd` instance, the token cannot pull the images, the commit is not in this clone, no public IPv4 |
| 4 | the network, the VM create, or the metadata check failed |
| 5 | ssh never came up (20 tries, 30 s apart) |
| 6 | upload |
| 7 | on-vm.sh did not start, ran past `max-hours` less 10 minutes, 10 status polls in a row failed (a spot preemption deletes the VM), or exited non-zero (its code is printed) |
| 8 | copy-back |
| 9 | something labelled or named by this tool is still there after the clean-up; wins over every other code |

`on-vm.sh` (on the VM, in `/tmp/bioavanced-cd/exit-code`):

| code | meaning |
|---|---|
| 0 | done |
| 2 | `/tmp/run.env` missing |
| 3 | the tree did not extract |
| 4, 5, 6 | the stack did not come up, a bootstrap one-shot did not exit 0, the projection worker is not up (as in showcase.yml) |
| 10 | Docker install |
| 11 | GHCR login or pull |
| 12 | building tsa-test and witness-test |
| 13 | smoke: the API or the frontend did not answer 200 |
| 14 | the showcase reel: Node, Playwright, the recording, or no mp4 left |

## Cost guards

- `--provisioning-model=SPOT`, `--max-run-duration=<max-hours>h` and
  `--instance-termination-action=DELETE` on every create: GCP deletes the VM
  at the limit, never stops it.
- The driver gives up 10 minutes before that limit.
- Preflight refuses to start while any `owner=bioavanced-cd` instance exists.
- `--no-service-account --no-scopes`: the VM holds no GCP credentials.
- `c4-*` and `c4d-*` machine types get `hyperdisk-balanced`, which they
  require; others get `pd-balanced`.

## Windows notes

- Call `gcloud.cmd`, never plain `gcloud`, which runs the POSIX wrapper and
  finds no Python. The script prepends the SDK's `bin` to PATH.
- `gcloud.cmd` runs under cmd.exe from a path holding a space: no argument may
  hold a space, and cmd.exe acts on `>`, `<`, `|`, `&`, `^`, `(`, `)` and
  quotes (a `>` in a `--filter` writes an empty file). The script refuses such
  arguments, reads every list as `--format=json` and filters it in node.
- `gcloud compute ssh` and `scp` run PuTTY's `plink` and `pscp`: they get
  `--strict-host-key-checking=no --quiet` and no stdin.
- `gcloud compute scp` reads `C:/...` as an instance named `C`, so the script
  runs every call from `--out` with relative paths.
- The tree is archived with `git -c core.autocrlf=false archive`, since a
  system gitconfig with `core.autocrlf=true` writes CRs into the archive.

## SSH keys

Without `block-project-ssh-keys`, the first `gcloud compute ssh` writes the
PC's key into the project-wide SSH metadata, which reaches every VM in the
project that does not block project keys, other members' included. The VM is
created with `block-project-ssh-keys=TRUE` and the driver checks it before
any ssh, so gcloud adds the key to that instance's `ssh-keys` only.
`enable-oslogin=FALSE` keeps a project-wide OS Login setting from taking over
(OS Login would give a user without sudo). `--ssh-key-file=gce-key` makes a
fresh key pair in `--out` instead of using `~/.ssh/google_compute_engine`. A
user added by instance `ssh-keys` gets passwordless sudo on Google's Ubuntu
images.

## Out of scope here

The GitHub Actions run with keyless auth, the HTTPS load balancer and IAP, and
the reference snapshot restore (#1562).
