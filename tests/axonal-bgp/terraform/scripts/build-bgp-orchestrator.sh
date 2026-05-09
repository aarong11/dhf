#!/usr/bin/env bash
# Build the BGP orchestrator image.
set -euo pipefail

: "${BGP_DIR:?BGP_DIR required}"
: "${IMAGE_TAG:?IMAGE_TAG required}"

docker build -t "ecca-bgp-orchestrator:${IMAGE_TAG}" \
  -f "${BGP_DIR}/Dockerfile.orchestrator" "${BGP_DIR}"
echo "✓ ecca-bgp-orchestrator:${IMAGE_TAG} built"
