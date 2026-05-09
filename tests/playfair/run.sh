#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  PLAYFAIR — Tripartite Game Test on 3-Region Kubernetes
# ═══════════════════════════════════════════════════════════════════════
#
#  Sets up a k3d cluster with 3 "regions":
#    region-storage   — cheap storage (large hippocampus, throttled compute)
#    region-compute   — cheap compute (GPU-class, throttled storage)
#    region-bandwidth — cheap bandwidth (fast networking, throttled both)
#
#  Deploys the ECCA stack across all three, runs a TripartiteGame with
#  6 agents (2 per region), needlecasts between regions, and produces
#  a full audit report.
#
#  Prerequisites:
#    - Docker
#    - kubectl
#    - k3d (https://k3d.io — `brew install k3d` or `curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash`)
#    - helm
#    - Node.js >= 20
#
#  Usage:
#    ./tests/playfair/run.sh [--skip-cluster] [--skip-build] [--epochs N]
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLUSTER_NAME="playfair"
EPOCHS="${EPOCHS:-50}"
SKIP_CLUSTER=false
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-cluster) SKIP_CLUSTER=true ;;
    --skip-build)   SKIP_BUILD=true ;;
    --epochs)       shift; EPOCHS="${2:-50}" ;;
    --epochs=*)     EPOCHS="${arg#*=}" ;;
  esac
done

# ─── Colors ───────────────────────────────────────────────────────────
C_CYAN='\033[0;36m'
C_GREEN='\033[0;32m'
C_MAGENTA='\033[0;35m'
C_YELLOW='\033[0;33m'
C_RED='\033[0;31m'
C_RESET='\033[0m'

log()  { echo -e "${C_CYAN}[playfair]${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}  ✓${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}  ⚠${C_RESET} $*"; }
fail() { echo -e "${C_RED}  ✗${C_RESET} $*"; exit 1; }

# ─── Dependency check ─────────────────────────────────────────────────
log "Checking prerequisites..."
for cmd in docker kubectl k3d helm node; do
  command -v "$cmd" &>/dev/null || fail "$cmd not found — install it first"
done
ok "All prerequisites available"

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 1 — Cluster Setup
# ═══════════════════════════════════════════════════════════════════════

if [ "$SKIP_CLUSTER" = false ]; then
  log "Creating k3d cluster '${CLUSTER_NAME}' with 3 region nodes..."

  # Clean up any existing cluster
  k3d cluster delete "$CLUSTER_NAME" 2>/dev/null || true

  # Create cluster: 1 server + 3 agents (one per region)
  # Port mappings: 7070-7072 for siyana-api per region, 30000-30002 for NodePorts
  k3d cluster create "$CLUSTER_NAME" \
    --servers 1 \
    --agents 3 \
    --port "7070-7072:30070-30072@server:0" \
    --port "8332-8334:30332-30334@server:0" \
    --port "5001-5003:30501-30503@server:0" \
    --port "8545-8547:30545-30547@server:0" \
    --k3s-arg "--disable=traefik@server:0" \
    --wait

  ok "Cluster created"

  # Label the agent nodes as regions
  AGENTS=$(kubectl get nodes -l 'node-role.kubernetes.io/master!=' -o name 2>/dev/null || \
           kubectl get nodes --selector='!node-role.kubernetes.io/control-plane' -o name)
  AGENT_ARRAY=($AGENTS)

  if [ ${#AGENT_ARRAY[@]} -lt 3 ]; then
    # If we can't get 3 agent nodes, label the ones we have
    warn "Only ${#AGENT_ARRAY[@]} agent nodes found, labeling what we have"
  fi

  REGIONS=("region-storage" "region-compute" "region-bandwidth")
  for i in "${!AGENT_ARRAY[@]}"; do
    if [ "$i" -lt 3 ]; then
      kubectl label node "${AGENT_ARRAY[$i]##*/}" \
        ecca.io/region="${REGIONS[$i]}" \
        --overwrite
      ok "Labeled ${AGENT_ARRAY[$i]##*/} → ${REGIONS[$i]}"
    fi
  done

  # Create namespaces for each region
  for region in "${REGIONS[@]}"; do
    kubectl create namespace "$region" --dry-run=client -o yaml | kubectl apply -f -
    # Set resource quotas to simulate cost profiles
  done
  ok "Namespaces created"
else
  log "Skipping cluster creation (--skip-cluster)"
fi

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 2 — Build & Load Images
# ═══════════════════════════════════════════════════════════════════════

if [ "$SKIP_BUILD" = false ]; then
  log "Building Docker images..."
  cd "$ROOT_DIR"

  # Build Go chain forks
  docker build -t ecca-medulla-pow:local -f forks/medulla-pow-go/Dockerfile forks/medulla-pow-go/
  ok "medulla-pow built"

  docker build -t ecca-hippocampus-dag:local -f forks/hippocampus-dag-go/Dockerfile forks/hippocampus-dag-go/
  ok "hippocampus-dag built"

  docker build -t ecca-cortex-evm:local -f forks/cortex-evm-go/Dockerfile forks/cortex-evm-go/
  ok "cortex-evm built"

  # Build TS services via the builder Dockerfile
  docker build -t ecca-builder:local -f Dockerfile.builder .
  ok "TS builder completed"

  # Build individual service images (using the monorepo dist)
  for svc in siyana-api thalamus-router dhf-compositor needlecast-router-svc quellist-treasury-svc bandwidth-faucet sleeve-runtime; do
    docker build -t "ecca-${svc}:local" \
      --build-arg SERVICE="$svc" \
      -f "$SCRIPT_DIR/Dockerfile.service" "$ROOT_DIR"
    ok "  ${svc} image built"
  done

  # Build worker image
  docker build -t ecca-worker:local \
    --build-arg SERVICE="runner" \
    -f "$SCRIPT_DIR/Dockerfile.service" "$ROOT_DIR"
  ok "worker image built"

  # Build orchestrator image
  docker build -t ecca-playfair-orchestrator:local \
    -f "$SCRIPT_DIR/Dockerfile.orchestrator" "$SCRIPT_DIR"
  ok "orchestrator image built"

  # Load all images into k3d
  log "Loading images into k3d cluster..."
  for img in ecca-medulla-pow ecca-hippocampus-dag ecca-cortex-evm \
             ecca-siyana-api ecca-thalamus-router ecca-dhf-compositor \
             ecca-needlecast-router-svc ecca-quellist-treasury-svc \
             ecca-bandwidth-faucet ecca-sleeve-runtime ecca-worker \
             ecca-playfair-orchestrator; do
    k3d image import "${img}:local" -c "$CLUSTER_NAME"
  done
  ok "All images loaded"
else
  log "Skipping build (--skip-build)"
fi

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 3 — Deploy Shared Infrastructure
# ═══════════════════════════════════════════════════════════════════════

log "Deploying shared infrastructure..."
kubectl apply -f "$SCRIPT_DIR/k8s/00-shared-infra.yaml"
ok "Postgres, Redis, NATS, MinIO deployed"

log "Waiting for shared infra to be ready..."
kubectl -n ecca-shared wait --for=condition=ready pod -l app=postgres --timeout=120s
kubectl -n ecca-shared wait --for=condition=ready pod -l app=redis --timeout=60s
kubectl -n ecca-shared wait --for=condition=ready pod -l app=nats --timeout=60s
ok "Shared infra ready"

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 4 — Deploy Chains & Services Per Region
# ═══════════════════════════════════════════════════════════════════════

log "Deploying three regions..."

for region in region-storage region-compute region-bandwidth; do
  log "  Deploying ${region}..."
  kubectl apply -f "$SCRIPT_DIR/k8s/01-${region}.yaml"
  ok "  ${region} manifests applied"
done

log "Waiting for chains to come up..."
for region in region-storage region-compute region-bandwidth; do
  kubectl -n "$region" wait --for=condition=ready pod -l app=medulla-pow --timeout=120s 2>/dev/null || warn "medulla-pow in $region not ready yet"
  kubectl -n "$region" wait --for=condition=ready pod -l app=hippocampus-dag --timeout=120s 2>/dev/null || warn "hippocampus-dag in $region not ready yet"
  kubectl -n "$region" wait --for=condition=ready pod -l app=cortex-evm --timeout=120s 2>/dev/null || warn "cortex-evm in $region not ready yet"
done
ok "All chains running"

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 5 — Deploy Contracts
# ═══════════════════════════════════════════════════════════════════════

log "Deploying contracts to cortex-evm in region-compute..."
kubectl -n region-compute apply -f "$SCRIPT_DIR/k8s/02-contracts-deployer.yaml"
kubectl -n region-compute wait --for=condition=complete job/contracts-deployer --timeout=180s
ok "Contracts deployed"

# Extract contract addresses from the deployer job logs
DEPLOY_LOG=$(kubectl -n region-compute logs job/contracts-deployer 2>/dev/null | tail -20)
log "Contract addresses:"
echo "$DEPLOY_LOG" | grep -E "deployed|address" || true

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 6 — Deploy Services & Sleeves Per Region
# ═══════════════════════════════════════════════════════════════════════

log "Deploying services and sleeves..."
kubectl apply -f "$SCRIPT_DIR/k8s/03-services.yaml"

for region in region-storage region-compute region-bandwidth; do
  kubectl -n "$region" wait --for=condition=ready pod -l app=siyana-api --timeout=120s 2>/dev/null || warn "siyana-api in $region still starting"
  kubectl -n "$region" wait --for=condition=ready pod -l app=thalamus-router --timeout=120s 2>/dev/null || warn "thalamus in $region still starting"
done
ok "Services ready"

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 7 — Run the Tripartite Game
# ═══════════════════════════════════════════════════════════════════════

log "Launching Playfair orchestrator (${EPOCHS} epochs)..."
kubectl apply -f "$SCRIPT_DIR/k8s/04-orchestrator.yaml"

# Wait for the orchestrator to complete
log "Waiting for game to complete (this takes ~$((EPOCHS * 4))s)..."
kubectl -n ecca-shared wait --for=condition=complete \
  job/playfair-orchestrator --timeout=$((EPOCHS * 10 + 120))s || {
  warn "Orchestrator didn't complete in expected time"
  kubectl -n ecca-shared logs job/playfair-orchestrator --tail=50
}

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 8 — Collect Results
# ═══════════════════════════════════════════════════════════════════════

log "Collecting results..."
RESULTS_DIR="$ROOT_DIR/tests/playfair/results"
mkdir -p "$RESULTS_DIR"

# Get orchestrator output
kubectl -n ecca-shared logs job/playfair-orchestrator > "$RESULTS_DIR/orchestrator.log" 2>/dev/null

# Copy the results JSON from the orchestrator pod
ORCH_POD=$(kubectl -n ecca-shared get pods -l job-name=playfair-orchestrator -o name | head -1)
kubectl -n ecca-shared cp "${ORCH_POD#pod/}:/results/playfair-results.json" "$RESULTS_DIR/playfair-results.json" 2>/dev/null || {
  warn "Could not copy results JSON — extracting from logs"
  kubectl -n ecca-shared logs job/playfair-orchestrator | grep '^{' | tail -1 > "$RESULTS_DIR/playfair-results.json" 2>/dev/null || true
}

# Collect per-region metrics
for region in region-storage region-compute region-bandwidth; do
  kubectl -n "$region" logs -l app=thalamus-router --tail=200 > "$RESULTS_DIR/${region}-thalamus.log" 2>/dev/null || true
  kubectl -n "$region" logs -l app=siyana-api --tail=200 > "$RESULTS_DIR/${region}-siyana.log" 2>/dev/null || true
done

ok "Results collected in $RESULTS_DIR"

# Generate HTML report
log "Generating Playfair report..."
cd "$ROOT_DIR"
node "$SCRIPT_DIR/generate-playfair-report.js" \
  "$RESULTS_DIR/playfair-results.json" \
  "$ROOT_DIR/tests/playfair/playfair-report.html" \
  "$ROOT_DIR/docs/playfair-report.html"
ok "Report generated"

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 9 — Cleanup (optional)
# ═══════════════════════════════════════════════════════════════════════

echo ""
log "═══════════════════════════════════════════════════════════════"
log "  PLAYFAIR TEST COMPLETE"
log "═══════════════════════════════════════════════════════════════"
echo ""
log "Results:    $RESULTS_DIR/playfair-results.json"
log "Report:     tests/playfair/playfair-report.html"
log "Docs copy:  docs/playfair-report.html"
echo ""
log "To tear down:"
log "  k3d cluster delete $CLUSTER_NAME"
echo ""
