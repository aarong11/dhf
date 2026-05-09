variable "cluster_name" {
  description = "k3d cluster name"
  type        = string
  default     = "axonal-bgp"
}

variable "epochs" {
  description = "Number of simulation epochs"
  type        = number
  default     = 50
}

variable "image_tag" {
  description = "Tag applied to locally-built images"
  type        = string
  default     = "local"
}

variable "skip_images" {
  description = "Skip docker image builds (assumes images already built)"
  type        = bool
  default     = false
}

variable "skip_orchestrator" {
  description = "Skip launching the orchestrator job (deploys infra only)"
  type        = bool
  default     = false
}

variable "force_image_rebuild" {
  description = "Bump this to force rebuild even if hashes are unchanged"
  type        = string
  default     = ""
}

variable "wait_timeout_seconds" {
  description = "Timeout per kubectl wait step"
  type        = number
  default     = 240
}
