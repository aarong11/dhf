#!/usr/bin/env bash
# Build the BGP agent image.
set -euo pipefail

: "${BGP_DIR:?BGP_DIR required}"
: "${IMAGE_TAG:?IMAGE_TAG required}"

docker build -t "ecca-bgp-agent:${IMAGE_TAG}" \
  -f "${BGP_DIR}/Dockerfile.agent" "${BGP_DIR}"
echo "✓ ecca-bgp-agent:${IMAGE_TAG} built"
