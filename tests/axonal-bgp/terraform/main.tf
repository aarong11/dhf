locals {
  module_root = path.module
  bgp_dir     = abspath("${path.module}/..")
  repo_root   = abspath("${path.module}/../../..")
  script_dir  = "${path.module}/scripts"
  results_dir = "${abspath(path.module)}/../results"
  k8s_dir     = abspath("${path.module}/../k8s")

  all_image_refs = [
    "ecca-bgp-agent:${var.image_tag}",
    "ecca-bgp-orchestrator:${var.image_tag}",
    "ecca-ts-builder:${var.image_tag}",
  ]

  shell_env = {
    CLUSTER_NAME = var.cluster_name
    REPO_ROOT    = local.repo_root
    BGP_DIR      = local.bgp_dir
    K8S_DIR      = local.k8s_dir
    RESULTS_DIR  = local.results_dir
    IMAGE_TAG    = var.image_tag
  }
}

# ═══════════════════════════════════════════════════════════════════════
#  k3d cluster
# ═══════════════════════════════════════════════════════════════════════

resource "null_resource" "k3d_cluster" {
  triggers = {
    name = var.cluster_name
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      if k3d cluster list -o json | grep -q '"name":"${var.cluster_name}"'; then
        echo "Cluster ${var.cluster_name} already exists"
      else
        k3d cluster create ${var.cluster_name} \
          --servers 1 \
          --agents 1 \
          --no-lb \
          --k3s-arg "--disable=traefik@server:0" \
          --timeout 120s
      fi
      kubectl config use-context k3d-${var.cluster_name}
    EOT
  }

  provisioner "local-exec" {
    when    = destroy
    command = "k3d cluster delete ${self.triggers.name} 2>/dev/null || true"
  }
}

# ═══════════════════════════════════════════════════════════════════════
#  Docker images
# ═══════════════════════════════════════════════════════════════════════

resource "null_resource" "image_ts_builder" {
  triggers = {
    force_rebuild = var.force_image_rebuild
    skip          = tostring(var.skip_images)
  }

  provisioner "local-exec" {
    command = var.skip_images ? "echo 'skip ts-builder'" : "bash ${local.script_dir}/build-ts-builder.sh"
    environment = local.shell_env
  }
}

resource "null_resource" "image_bgp_agent" {
  triggers = {
    force_rebuild = var.force_image_rebuild
    skip          = tostring(var.skip_images)
  }

  provisioner "local-exec" {
    command = var.skip_images ? "echo 'skip bgp-agent'" : "bash ${local.script_dir}/build-bgp-agent.sh"
    environment = local.shell_env
  }
}

resource "null_resource" "image_bgp_orchestrator" {
  triggers = {
    force_rebuild = var.force_image_rebuild
    skip          = tostring(var.skip_images)
  }

  provisioner "local-exec" {
    command = var.skip_images ? "echo 'skip bgp-orchestrator'" : "bash ${local.script_dir}/build-bgp-orchestrator.sh"
    environment = local.shell_env
  }
}

# ═══════════════════════════════════════════════════════════════════════
#  Import images into k3d
# ═══════════════════════════════════════════════════════════════════════

resource "null_resource" "k3d_image_import" {
  triggers = {
    cluster_id = null_resource.k3d_cluster.id
    image_refs = join(",", sort(local.all_image_refs))
    agent_id   = null_resource.image_bgp_agent.id
    orch_id    = null_resource.image_bgp_orchestrator.id
    builder_id = null_resource.image_ts_builder.id
  }

  depends_on = [
    null_resource.k3d_cluster,
    null_resource.image_bgp_agent,
    null_resource.image_bgp_orchestrator,
    null_resource.image_ts_builder,
  ]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      for img in ${join(" ", sort(local.all_image_refs))}; do
        echo "→ importing $img..."
        k3d image import "$img" -c ${var.cluster_name}
      done
      echo "✓ all images loaded"
    EOT
    environment = local.shell_env
  }
}

# ═══════════════════════════════════════════════════════════════════════
#  Deploy K8s manifests
# ═══════════════════════════════════════════════════════════════════════

resource "null_resource" "k8s_namespace" {
  triggers = {
    cluster_id = null_resource.k3d_cluster.id
  }

  depends_on = [null_resource.k3d_image_import]

  provisioner "local-exec" {
    command     = "kubectl apply -f ${local.k8s_dir}/00-namespace.yaml"
    environment = local.shell_env
  }
}

resource "null_resource" "k8s_cortex_ready" {
  triggers = {
    ns_id = null_resource.k8s_namespace.id
  }

  depends_on = [null_resource.k8s_namespace]

  provisioner "local-exec" {
    command = <<-EOT
      kubectl -n bgp-sim wait --for=condition=ready pod -l app=cortex-evm \
        --timeout=${var.wait_timeout_seconds}s
      echo "✓ cortex-evm ready"
    EOT
  }
}

resource "null_resource" "k8s_contracts" {
  triggers = {
    cortex_id = null_resource.k8s_cortex_ready.id
  }

  depends_on = [null_resource.k8s_cortex_ready]

  provisioner "local-exec" {
    command = <<-EOT
      kubectl delete job contracts-deployer -n bgp-sim --ignore-not-found
      kubectl apply -f ${local.k8s_dir}/01-contracts-deployer.yaml
      kubectl -n bgp-sim wait --for=condition=complete job/contracts-deployer \
        --timeout=${var.wait_timeout_seconds}s
      echo "✓ contracts deployed"
    EOT
  }
}

resource "null_resource" "k8s_agents" {
  triggers = {
    contracts_id = null_resource.k8s_contracts.id
  }

  depends_on = [null_resource.k8s_contracts]

  provisioner "local-exec" {
    command = <<-EOT
      kubectl apply -f ${local.k8s_dir}/02-agents.yaml
      kubectl -n bgp-sim wait --for=condition=ready pod -l app=agent-bgp-100 \
        --timeout=${var.wait_timeout_seconds}s
      kubectl -n bgp-sim wait --for=condition=ready pod -l app=agent-bgp-200 \
        --timeout=${var.wait_timeout_seconds}s
      kubectl -n bgp-sim wait --for=condition=ready pod -l app=agent-bgp-300 \
        --timeout=${var.wait_timeout_seconds}s
      kubectl -n bgp-sim wait --for=condition=ready pod -l app=agent-bgp-400 \
        --timeout=${var.wait_timeout_seconds}s
      echo "✓ all 4 BGP agents ready"
    EOT
  }
}

resource "null_resource" "k8s_orchestrator" {
  count = var.skip_orchestrator ? 0 : 1

  triggers = {
    agents_id = null_resource.k8s_agents.id
    epochs    = var.epochs
  }

  depends_on = [null_resource.k8s_agents]

  provisioner "local-exec" {
    command     = "bash ${local.script_dir}/run-orchestrator.sh"
    environment = merge(local.shell_env, {
      EPOCHS = tostring(var.epochs)
    })
  }
}
