# Vendored JSON Schemas

Used by the YAML ↔ JSON converter to validate Kubernetes manifests, Docker
Compose files and GitHub Actions workflows without a network call. Each file
is the published schema with `description`, `$comment`, `markdownDescription`
and `x-kubernetes-*` annotations removed and whitespace minified (validation
keywords are unchanged), fetched on 23 November 2026.

| File | Source | Licence |
|---|---|---|
| `k8s-*.json` | yannh/kubernetes-json-schema, `v1.30.0-standalone-strict` (generated from the Kubernetes v1.30.0 OpenAPI spec) | Apache-2.0 |
| `compose-spec.json` | compose-spec/compose-spec, `schema/compose-spec.json` (JSON Schema 2020-12) | Apache-2.0 |
| `github-workflow.json` | SchemaStore, `github-workflow.json` (draft-07) | Apache-2.0 |

To refresh: download the same files again, run the same stripping
(`description`, `$comment`, `markdownDescription`, `x-kubernetes-*`), and
update the date above and the version shown on the YAML ↔ JSON page.
