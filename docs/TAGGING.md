# Tagging Standard

All Azure resources created by the PD Check Factory Bicep templates use a consistent set of tags for governance, cost allocation, and environment identification.

## Required tags

| Tag | Description | Example |
|-----|-------------|---------|
| `project` | Project or product name | `pd-check-factory` |
| `env` | Environment (dev, staging, prod) | `dev` |
| `owner` | Team or group responsible | `bioscope` |
| `costCenter` | Cost allocation unit | `innovation` |

## Optional tags

| Tag | Description | Example |
|-----|-------------|---------|
| `managedBy` | How the resource is managed | `bicep` |
| `region` | Azure region (location) | `westeurope` |
| `dataSensitivity` | Data classification | `internal` |

## Where tags are defined

- **Bicep**: The central `tags` object in [infra/bicep/main.bicep](../infra/bicep/main.bicep) is passed to every module. All resources created by the deployment receive these tags.
- **Environment config**: [infra/env/dev.yaml](../infra/env/dev.yaml) documents the tag values used for the `dev` environment; other environments (e.g. `staging`, `prod`) can have their own YAML files with different `owner` or `costCenter` if needed.

## Adding or changing tags

1. Update the `tags` object in `infra/bicep/main.bicep`.
2. Update the corresponding `tags` section in `infra/env/<env>.yaml` for consistency.
3. Redeploy; existing resources will get the new tags on the next deployment.
