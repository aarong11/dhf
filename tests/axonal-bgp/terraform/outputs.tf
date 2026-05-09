output "cluster_name" {
  value = var.cluster_name
}

output "results_dir" {
  value = local.results_dir
}

output "report_path" {
  value = "${local.bgp_dir}/axonal-bgp-report.html"
}

output "kubeconfig_hint" {
  value = "kubectl config use-context k3d-${var.cluster_name}"
}

output "agent_endpoints" {
  description = "BGP agent endpoints inside the cluster"
  value = {
    as_100 = "http://agent-bgp-100.bgp-sim:9090"
    as_200 = "http://agent-bgp-200.bgp-sim:9090"
    as_300 = "http://agent-bgp-300.bgp-sim:9090"
    as_400 = "http://agent-bgp-400.bgp-sim:9090"
  }
}

output "teardown" {
  value = "terraform destroy -auto-approve  # tears down cluster + state"
}
