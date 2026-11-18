#!/usr/bin/env bash
# Runs the showcase stack (#1565) on a self-deleting spot VM, driven from a
# Windows PC in Git Bash with the operator's own gcloud and gh logins. The
# runbook is docs/runbooks/gcp-spot-showcase.md.
#
#   bash scripts/gcp-spot-showcase/run-from-pc.sh --project=<project> \
#     --zone=<zone> --machine-type=<type> --image-tag=<40-char sha> \
#     --max-hours=<1-12> --ghcr-user=<github login> --out=<local dir> \
#     [--disk-gb=<30-500>] [--ghcr-token-file=<path>] [--showcase] [--dry-run]
#
# --ghcr-token-file names a file holding a read-only GitHub token (read:packages
# only); without it the token comes from gh auth token. The file is read here
# only and its path never goes to gcloud.
#
# Phases: preflight (no instance labelled owner=bioavanced-cd exists, the gh
# token can pull both published images, the tree at the tag is archived),
# network (a custom network of this run's own, with one tcp:22 rule from this
# PC's public IP /32), create (spot, max-run-duration, DELETE on termination),
# verify-metadata (block-project-ssh-keys is TRUE before any ssh), ssh-wait,
# upload, run (on-vm.sh under systemd-run, polled), copy-back. The EXIT trap
# deletes the VM and the network by the exact names this run made, then lists
# what is left.
#
# Exit codes: 2 a bad argument, 3 preflight, 4 network, create or metadata,
# 5 ssh never came up, 6 upload, 7 the run failed to start, timed out, lost
# the VM, or on-vm.sh exited non-zero (its code is printed), 8 copy-back,
# 9 an instance labelled owner=bioavanced-cd or a bioavanced-cd-net-* network
# or firewall rule is still there after the clean-up, which wins.
#
# Windows rules this script keeps: gcloud is called as gcloud.cmd (plain
# gcloud is the POSIX wrapper and finds no Python); gcloud.cmd runs under
# cmd.exe, so no argument may hold a space, a quote or any of > < | & ^ ( ),
# and every list is read as --format=json and filtered here; ssh and scp are
# PuTTY's plink and pscp, run stdin-less with --strict-host-key-checking=no
# --quiet; gcloud compute scp reads C:/... as an instance named C, so every
# call runs from the --out dir with relative local paths.
#
# SSH keys: the VM is created with block-project-ssh-keys=TRUE, checked before
# the first ssh, so gcloud adds its key to this instance's ssh-keys only and
# never to the project-wide metadata, which reaches every VM in the project
# that does not block project keys. enable-oslogin=FALSE keeps a project-wide
# OS Login setting from taking over. --ssh-key-file=gce-key makes a fresh key
# pair in the --out dir instead of ~/.ssh/google_compute_engine.
#
# Dry run: every gcloud call prints "DRY gcloud.cmd <args>" to stderr and runs
# nothing; gh, curl and git archive print "DRY would run: <command>". The env
# var DRY_RUN_FAIL_AT=<phase> makes the gcloud calls of that phase fail, to
# walk the trap.
set -u

usage() {
  echo "usage: run-from-pc.sh --project=<id> --zone=<zone> --machine-type=<type> --image-tag=<40-hex sha> --max-hours=<1-12> --ghcr-user=<login> --out=<dir> [--disk-gb=<30-500>] [--ghcr-token-file=<path>] [--showcase] [--dry-run]" >&2
  exit 2
}
bad() { echo "run-from-pc.sh: $1" >&2; usage; }

PROJECT='' ZONE='' MACHINE_TYPE='' IMAGE_TAG='' MAX_HOURS='' GHCR_USER='' OUT_ARG='' TOKEN_FILE=''
DISK_GB=100 SHOWCASE=0 DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --project=*) PROJECT="${arg#*=}" ;;
    --zone=*) ZONE="${arg#*=}" ;;
    --machine-type=*) MACHINE_TYPE="${arg#*=}" ;;
    --image-tag=*) IMAGE_TAG="${arg#*=}" ;;
    --max-hours=*) MAX_HOURS="${arg#*=}" ;;
    --ghcr-user=*) GHCR_USER="${arg#*=}" ;;
    --out=*) OUT_ARG="${arg#*=}" ;;
    --disk-gb=*) DISK_GB="${arg#*=}" ;;
    --ghcr-token-file=*) TOKEN_FILE="${arg#*=}" ;;
    --showcase) SHOWCASE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) bad "unknown argument: $arg" ;;
  esac
done

RE_PROJECT='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
RE_ZONE='^[a-z]+-[a-z]+[0-9]-[a-z]$'
RE_MACHINE='^[a-z0-9-]+$'
RE_TAG='^[0-9a-f]{40}$'
RE_HOURS='^([1-9]|1[0-2])$'
RE_USER='^[A-Za-z0-9-]+$'
RE_DISK='^[1-9][0-9]{1,2}$'
[[ "$PROJECT" =~ $RE_PROJECT ]] || bad "--project must match $RE_PROJECT"
[[ "$ZONE" =~ $RE_ZONE ]] || bad "--zone must match $RE_ZONE"
[[ "$MACHINE_TYPE" =~ $RE_MACHINE ]] || bad "--machine-type must match $RE_MACHINE"
[[ "$IMAGE_TAG" =~ $RE_TAG ]] || bad "--image-tag must be a 40-character lowercase hex commit SHA"
[[ "$MAX_HOURS" =~ $RE_HOURS ]] || bad "--max-hours must be an integer from 1 to 12"
[[ "$GHCR_USER" =~ $RE_USER ]] || bad "--ghcr-user must match $RE_USER"
[ -n "$OUT_ARG" ] || bad "--out is required"
{ [[ "$DISK_GB" =~ $RE_DISK ]] && [ "$DISK_GB" -ge 30 ] && [ "$DISK_GB" -le 500 ]; } \
  || bad "--disk-gb must be an integer from 30 to 500"
if [ -n "$TOKEN_FILE" ]; then
  [ -f "$TOKEN_FILE" ] || bad "--ghcr-token-file must name an existing regular file"
  # absolute, since the phases run from the --out dir
  TOKEN_FILE="$(cd "$(dirname "$TOKEN_FILE")" && pwd)/$(basename "$TOKEN_FILE")"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
mkdir -p "$OUT_ARG" || bad "cannot create --out $OUT_ARG"
OUT="$(cd "$OUT_ARG" && pwd)"

OWNER_LABEL=owner=bioavanced-cd
SSH_USER=bioavanced-cd
SUFFIX="${IMAGE_TAG:0:8}-$(date -u +%Y%m%d%H%M%S)"
NAME="bioavanced-cd-$SUFFIX"
NET="bioavanced-cd-net-$SUFFIX"
REGION="${ZONE%-*}"
case "$MACHINE_TYPE" in
  c4-*|c4d-*) DISK_TYPE=hyperdisk-balanced ;;  # c4 and c4d refuse pd-balanced
  *) DISK_TYPE=pd-balanced ;;
esac
# The run must end before GCP deletes the VM at --max-run-duration.
DEADLINE=$((MAX_HOURS * 3600 - 600))

GCLOUD_BIN="$LOCALAPPDATA/Google/Cloud SDK/google-cloud-sdk/bin"
command -v cygpath >/dev/null 2>&1 && GCLOUD_BIN="$(cygpath -u "$GCLOUD_BIN")"
export PATH="$GCLOUD_BIN:$PATH"
if [ "$DRY_RUN" = 0 ]; then
  TOOLS="gcloud.cmd curl node"
  [ -n "$TOKEN_FILE" ] || TOOLS="$TOOLS gh"
  for tool in $TOOLS; do
    command -v "$tool" >/dev/null 2>&1 || { echo "run-from-pc.sh: $tool not found on PATH" >&2; exit 3; }
  done
else
  command -v node >/dev/null 2>&1 || { echo "run-from-pc.sh: node not found on PATH" >&2; exit 3; }
fi

STEP=start
VM_ATTEMPTED=0
# Set only once the instance is seen to block project ssh keys: no ssh or scp,
# the clean-up's included, runs before that, since gcloud would otherwise
# write this PC's key into the project-wide metadata.
METADATA_OK=0
NET_ATTEMPTED=0
COPIED=0
CLEANED=0
CREATE_AT=0

# Every gcloud call goes through gc.
gc() {
  local a
  for a in "$@"; do
    case "$a" in
      *[[:space:]]*|*[\>\<\|\&\^\(\)\"\']*)
        echo "run-from-pc.sh: refused gcloud argument (space or cmd.exe metacharacter): $a" >&2
        exit 2 ;;
    esac
  done
  local extra=()
  if [ "${1:-}" = compute ] && { [ "${2:-}" = ssh ] || [ "${2:-}" = scp ]; }; then
    extra=("--zone=$ZONE" "--project=$PROJECT" --strict-host-key-checking=no --quiet --ssh-key-file=gce-key)
  fi
  if [ "$DRY_RUN" = 1 ]; then
    echo "DRY gcloud.cmd $*${extra[*]+ ${extra[*]}}" >&2
    if [ -n "${DRY_RUN_FAIL_AT:-}" ] && [ "$DRY_RUN_FAIL_AT" = "$STEP" ]; then
      return 1
    fi
    case "${1:-} ${2:-} ${3:-}" in
      "compute instances list"|"compute networks list"|"compute firewall-rules list") echo '[]' ;;
      "compute instances describe") echo '{"metadata":{"items":[{"key":"block-project-ssh-keys","value":"TRUE"}]}}' ;;
    esac
    # shellcheck disable=SC2016  # ${IFS} is the VM shell's, never expanded here
    case "$*" in
      *'--command=bash${IFS}/tmp/on-vm.sh${IFS}status'*) echo 0 ;;
    esac
    return 0
  fi
  (cd "$OUT" && gcloud.cmd "$@" ${extra[@]+"${extra[@]}"} </dev/null)
}

nap() { [ "$DRY_RUN" = 1 ] || sleep "$1"; }

# Reads a JSON array of resources on stdin and prints each name; exits 1 on
# anything that is not a JSON array.
NAMES_JS='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let a;try{a=JSON.parse(s)}catch(e){process.exit(1)}if(!Array.isArray(a))process.exit(1);for(const i of a)console.log(i.name)})'
# Exits 0 only when the instance's metadata has block-project-ssh-keys=TRUE.
BLOCKED_JS='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch(e){process.exit(1)}const it=((o.metadata||{}).items)||[];const k=it.find(x=>x.key==="block-project-ssh-keys");process.exit(k&&String(k.value).toLowerCase()==="true"?0:1)})'
# Prints the token field of the GHCR token reply.
TOKEN_JS='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).token||"")}catch(e){process.exit(1)}})'

our_instances() {
  local json
  json="$(gc compute instances list "--project=$PROJECT" "--filter=labels.$OWNER_LABEL" --format=json)" || return 1
  printf '%s' "$json" | node -e "$NAMES_JS"
}

our_net_resources() {
  local json names kind
  for kind in networks firewall-rules; do
    json="$(gc compute "$kind" list "--project=$PROJECT" --format=json)" || return 1
    names="$(printf '%s' "$json" | node -e "$NAMES_JS")" || return 1
    printf '%s\n' "$names" | tr -d '\r' | grep '^bioavanced-cd-net-' | sed "s/^/$kind: /"
  done
  return 0
}

ACCEPT='Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json'

check_ghcr() {
  local code bearer image
  local scope=repository:deniseribeiro-beep/bioavanced-backend-test:pull
  if [ "$DRY_RUN" = 1 ]; then
    if [ -n "$TOKEN_FILE" ]; then
      echo "DRY would run: cp $TOKEN_FILE ghcr-token" >&2
    else
      echo "DRY would run: gh auth token > ghcr-token" >&2
    fi
    echo "DRY would run: curl -s -K - -o token.json https://ghcr.io/token?scope=$scope (user $GHCR_USER:<token>)" >&2
    for image in bioavanced-backend-test bioavanced-frontend-test; do
      echo "DRY would run: curl -s -K - -I https://ghcr.io/v2/deniseribeiro-beep/$image/manifests/$IMAGE_TAG (Authorization: Bearer <token>)" >&2
    done
    return 0
  fi
  if [ -n "$TOKEN_FILE" ]; then
    (umask 077; cp -- "$TOKEN_FILE" ghcr-token.tmp && tr -d '\r\n' < ghcr-token.tmp > ghcr-token && rm -f ghcr-token.tmp) \
      || { rm -f ghcr-token.tmp; echo "run-from-pc.sh: cannot copy --ghcr-token-file" >&2; exit 3; }
  else
    (umask 077; gh auth token > ghcr-token) || { echo "run-from-pc.sh: gh auth token failed (log in with gh auth login)" >&2; exit 3; }
  fi
  [ -s ghcr-token ] || { echo "run-from-pc.sh: the GHCR token is empty" >&2; exit 3; }
  code="$(printf 'user = "%s:%s"\n' "$GHCR_USER" "$(cat ghcr-token)" \
    | curl -s -K - -o token.json -w '%{http_code}' "https://ghcr.io/token?scope=$scope")"
  [ "$code" = 200 ] || { echo "run-from-pc.sh: the token cannot pull bioavanced-backend-test:$IMAGE_TAG (needs read:packages, and the tag must be one publish-images.yml published); token reply $code" >&2; exit 3; }
  bearer="$(node -e "$TOKEN_JS" < token.json)" || { echo "run-from-pc.sh: the GHCR token reply is not JSON" >&2; exit 3; }
  rm -f token.json
  for image in bioavanced-backend-test bioavanced-frontend-test; do
    code="$(printf 'header = "Authorization: Bearer %s"\nheader = "%s"\n' "$bearer" "$ACCEPT" \
      | curl -s -K - -I -o /dev/null -w '%{http_code}' "https://ghcr.io/v2/deniseribeiro-beep/$image/manifests/$IMAGE_TAG")"
    [ "$code" = 200 ] || { echo "run-from-pc.sh: the token cannot pull $image:$IMAGE_TAG (needs read:packages, and the tag must be one publish-images.yml published); manifest reply $code" >&2; exit 3; }
  done
}

cleanup() {
  local rc=$? left
  # A repeated Ctrl-C must not cut the deletes or the final list short; an
  # ignored signal stays ignored in the gcloud calls below too.
  trap '' INT TERM
  [ "$CLEANED" = 1 ] && return
  echo "run-from-pc.sh: cleaning up; Ctrl-C is ignored until it finishes" >&2
  CLEANED=1
  STEP=cleanup
  cd "$OUT" || true
  rm -f ghcr-token ghcr-token.tmp token.json
  if [ "$METADATA_OK" = 1 ] && [ "$COPIED" = 0 ]; then
    # Best effort, one try: a failed run still brings its logs back.
    if gc compute scp "$SSH_USER@$NAME:/tmp/bioavanced-cd/out.tgz" . && [ "$DRY_RUN" = 0 ]; then
      mkdir -p vm-out && tar -xzf out.tgz -C vm-out || true
    fi
  fi
  if [ "$VM_ATTEMPTED" = 1 ]; then
    gc compute instances delete "$NAME" "--project=$PROJECT" "--zone=$ZONE" --quiet \
      || echo "run-from-pc.sh: the delete of $NAME failed" >&2
  fi
  if [ "$NET_ATTEMPTED" = 1 ]; then
    gc compute firewall-rules delete "$NET-ssh" "--project=$PROJECT" --quiet || true
    gc compute networks subnets delete "$NET" "--project=$PROJECT" "--region=$REGION" --quiet || true
    gc compute networks delete "$NET" "--project=$PROJECT" --quiet || true
  fi
  if left="$(our_instances)"; then
    left="$(printf '%s' "$left" | tr -d '\r')"
    if [ -n "$left" ]; then
      echo "run-from-pc.sh: instances labelled $OWNER_LABEL are still there:" >&2
      printf '%s\n' "$left" >&2
      rc=9
    fi
  else
    echo "run-from-pc.sh: the final instance list failed; check it by hand" >&2
    rc=9
  fi
  if left="$(our_net_resources)"; then
    if [ -n "$left" ]; then
      echo "run-from-pc.sh: bioavanced-cd-net-* resources are still there:" >&2
      printf '%s\n' "$left" >&2
      rc=9
    fi
  else
    echo "run-from-pc.sh: the final network or firewall list failed; check it by hand" >&2
    rc=9
  fi
  exit "$rc"
}

main() {
  local names json ip i ok r fails remote_rc=''
  cd "$OUT" || exit 3

  STEP=preflight
  names="$(our_instances)" || { echo "run-from-pc.sh: the instance list failed" >&2; exit 3; }
  names="$(printf '%s' "$names" | tr -d '\r')"
  if [ -n "$names" ]; then
    echo "run-from-pc.sh: a previous run left instances labelled $OWNER_LABEL; delete them first:" >&2
    printf '%s\n' "$names" >&2
    exit 3
  fi
  check_ghcr
  if [ "$DRY_RUN" = 1 ]; then
    echo "DRY would run: git -C $REPO_ROOT -c core.autocrlf=false archive --format=tar.gz -o $OUT/repo.tgz $IMAGE_TAG" >&2
  else
    git -C "$REPO_ROOT" cat-file -e "$IMAGE_TAG^{commit}" 2>/dev/null \
      || { echo "run-from-pc.sh: commit $IMAGE_TAG is not in this clone; fetch the commit first" >&2; exit 3; }
    # core.autocrlf=false: a system gitconfig with autocrlf=true would write
    # CRs into the archived files.
    git -C "$REPO_ROOT" -c core.autocrlf=false archive --format=tar.gz -o "$OUT/repo.tgz" "$IMAGE_TAG" \
      || { echo "run-from-pc.sh: git archive failed" >&2; exit 3; }
  fi
  printf 'IMAGE_TAG=%s\nGHCR_USER=%s\nSHOWCASE=%s\n' "$IMAGE_TAG" "$GHCR_USER" "$SHOWCASE" > run.env
  tr -d '\r' < "$SCRIPT_DIR/on-vm.sh" > on-vm.sh || exit 3

  STEP=network
  if [ "$DRY_RUN" = 1 ]; then
    ip=203.0.113.7
  else
    ip="$(curl -s https://api.ipify.org)"
  fi
  [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "run-from-pc.sh: no public IPv4 for this PC (read '$ip')" >&2; exit 3; }
  NET_ATTEMPTED=1
  gc compute networks create "$NET" "--project=$PROJECT" --subnet-mode=custom || exit 4
  gc compute networks subnets create "$NET" "--project=$PROJECT" "--network=$NET" "--region=$REGION" --range=10.201.0.0/24 || exit 4
  gc compute firewall-rules create "$NET-ssh" "--project=$PROJECT" "--network=$NET" --direction=INGRESS --action=ALLOW \
    --rules=tcp:22 "--source-ranges=$ip/32" || exit 4

  STEP=create
  VM_ATTEMPTED=1
  CREATE_AT=$SECONDS
  gc compute instances create "$NAME" "--project=$PROJECT" "--zone=$ZONE" "--machine-type=$MACHINE_TYPE" \
    --provisioning-model=SPOT "--max-run-duration=${MAX_HOURS}h" --instance-termination-action=DELETE \
    "--labels=$OWNER_LABEL" --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
    "--boot-disk-size=${DISK_GB}GB" "--boot-disk-type=$DISK_TYPE" "--network=$NET" "--subnet=$NET" \
    --no-service-account --no-scopes --metadata=block-project-ssh-keys=TRUE,enable-oslogin=FALSE || exit 4

  STEP=verify-metadata
  json="$(gc compute instances describe "$NAME" "--project=$PROJECT" "--zone=$ZONE" --format=json)" \
    || { echo "run-from-pc.sh: the describe of $NAME failed" >&2; exit 4; }
  printf '%s' "$json" | node -e "$BLOCKED_JS" \
    || { echo "run-from-pc.sh: $NAME does not block project ssh keys; no ssh is run" >&2; exit 4; }
  METADATA_OK=1

  STEP=ssh-wait
  ok=0
  for i in $(seq 1 20); do
    if gc compute ssh "$SSH_USER@$NAME" --command=true; then ok=1; break; fi
    echo "run-from-pc.sh: ssh try $i refused; the VM may still be booting" >&2
    nap 30
  done
  [ "$ok" = 1 ] || exit 5

  STEP=upload
  gc compute scp repo.tgz on-vm.sh run.env ghcr-token "$SSH_USER@$NAME:/tmp/" || { rm -f ghcr-token; exit 6; }
  rm -f ghcr-token

  STEP=run
  # shellcheck disable=SC2016  # ${IFS} is expanded by the VM's shell
  gc compute ssh "$SSH_USER@$NAME" '--command=sudo${IFS}systemd-run${IFS}--unit=bioavanced-cd${IFS}--collect${IFS}bash${IFS}/tmp/on-vm.sh' \
    || { echo "run-from-pc.sh: on-vm.sh did not start" >&2; exit 7; }
  fails=0
  while :; do
    if [ $((SECONDS - CREATE_AT)) -ge "$DEADLINE" ]; then
      echo "run-from-pc.sh: on-vm.sh did not finish within ${MAX_HOURS}h less 10 minutes" >&2
      exit 7
    fi
    nap 30
    # shellcheck disable=SC2016  # ${IFS} is expanded by the VM's shell
    if r="$(gc compute ssh "$SSH_USER@$NAME" '--command=bash${IFS}/tmp/on-vm.sh${IFS}status')"; then
      fails=0
      r="$(printf '%s\n' "$r" | tr -d '\r' | sed '/^$/d' | tail -n 1)"
      case "$r" in
        ''|*[!0-9]*) ;;
        *) remote_rc="$r"; break ;;
      esac
    else
      fails=$((fails + 1))
      if [ "$fails" -ge 10 ]; then
        echo "run-from-pc.sh: 10 status polls in a row failed; a spot preemption deletes the VM" >&2
        exit 7
      fi
    fi
  done

  STEP=copy-back
  gc compute scp "$SSH_USER@$NAME:/tmp/bioavanced-cd/out.tgz" . || exit 8
  if [ "$DRY_RUN" = 0 ]; then
    mkdir -p vm-out && tar -xzf out.tgz -C vm-out || exit 8
  fi
  COPIED=1
  if [ "$remote_rc" != 0 ]; then
    echo "run-from-pc.sh: on-vm.sh exited $remote_rc; its logs are in $OUT/vm-out/out" >&2
    exit 7
  fi
  echo "run-from-pc.sh: done; the VM's output is in $OUT/vm-out/out"
  exit 0
}

trap cleanup EXIT
trap 'exit 130' INT TERM
main
