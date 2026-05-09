#!/usr/bin/env bash
# Build the TS builder image (full monorepo build).
set -euo pipefail

: "${REPO_ROOT:?REPO_ROOT required}"
: "${IMAGE_TAG:?IMAGE_TAG required}"

docker build -t "ecca-ts-builder:${IMAGE_TAG}" \
  -f "${REPO_ROOT}/Dockerfile.builder" "${REPO_ROOT}"
echo "✓ ecca-ts-builder:${IMAGE_TAG} built"
