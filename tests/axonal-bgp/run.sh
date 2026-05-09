#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  AXONAL-BGP — Routing Security Simulation (thin terraform wrapper)
# ═══════════════════════════════════════════════════════════════════════
#
#  Usage:
#    ./tests/axonal-bgp/run.sh                      # full apply
#    ./tests/axonal-bgp/run.sh --skip-images        # reuse local images
#    ./tests/axonal-bgp/run.sh --skip-orchestrator   # deploy infra only
#    ./tests/axonal-bgp/run.sh --epochs 100          # custom epoch count
#    ./tests/axonal-bgp/run.sh --destroy             # tear down cluster
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${SCRIPT_DIR}/terraform"
ACTION="apply"
TF_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-images)        TF_ARGS+=(-var "skip_images=true") ;;
    --skip-orchestrator)  TF_ARGS+=(-var "skip_orchestrator=true") ;;
    --force-rebuild)      TF_ARGS+=(-var "force_image_rebuild=$(date +%s)") ;;
    --epochs)             shift; TF_ARGS+=(-var "epochs=${1}") ;;
    --epochs=*)           TF_ARGS+=(-var "epochs=${1#*=}") ;;
    --destroy)            ACTION="destroy" ;;
    --plan)               ACTION="plan" ;;
    --help|-h)
      sed -n '2,14p' "$0" | sed 's/^#//; s/^ //'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

cd "$TF_DIR"

if [ ! -d .terraform ]; then
  echo "→ Initializing terraform..."
  terraform init
fi

case "$ACTION" in
  apply)   terraform apply -auto-approve "${TF_ARGS[@]}" ;;
  destroy) terraform destroy -auto-approve "${TF_ARGS[@]}" ;;
  plan)    terraform plan "${TF_ARGS[@]}" ;;
esac
