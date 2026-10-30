# Phase 2 HBEC review

Reviewed 2026-10-30 against the read-only HBEC workspace.

## Extraction result

| Compose file | Raw services | Logical graph nodes | Typed edges | YAML/graph errors |
| --- | ---: | ---: | ---: | ---: |
| `docker-compose.yml` | 36 | 37 | 66 | 0 |
| `docker-compose.production.yml` | 54 | 38 | 68 | 0 |

Graph nodes include named databases, so the node count is not just a normalized service count. The production diagram opens with seven areas: Student, Admin, Harness, Notifications, Payments, Schools, and Infrastructure. Production student backend, for example, combines the legacy service, blue and green variants, worker, and beat into one logical node. The default map aggregates same-pair links and hides startup dependencies; they remain available through the link filter.

## Sampled source-backed links

The following production links were compared with their Compose declarations. All are present with correct direction and navigable lines:

| Link | Declaration |
| --- | --- |
| student backend → harness | `HARNESS_SERVICE_URL`, line 775 |
| student backend → admin backend | `ADMIN_SERVICE_URL`, line 782 |
| student backend → payments | `PAYMENT_SERVICE_URL`, line 841 |
| admin backend → student backend | `STUDENT_SERVICE_URL`, line 965 |
| admin backend → schools backend | `SCHOOLS_SERVICE_URL`, line 967 |
| harness → embedding service | `EMBEDDING_SERVICE_URL`, line 1171 |
| payments → student backend | `STUDENT_BACKEND_URL`, line 1768 |
| notifications → student backend | `STUDENT_BACKEND_URL`, line 1823 |
| student backend → hbec_student database | `POSTGRES_DB`, line 758 |
| notifications → hbec_notifications database | `DATABASE_URL` in notifications environment |

No false edge was found in this sample. The parser does not make an edge merely because services share a Compose network. `depends_on` is a separately labelled startup relationship, not presented as an application call.

## Known omissions and next boundary

- HBEC's local `docker/caddy` directory contains no Caddyfile, so gateway routes cannot be established from that mounted path. No gateway-to-service arrows are invented.
- Frontend request paths and event/stream names are not extracted from Compose. They belong to focused code/config analysis in a later phase.
- An inherited YAML value may link to the service's environment/anchor use when the declaration itself is not directly in that service block. The details panel exposes every source location collected across grouped variants.
- This is static declared topology. A URL in configuration establishes a configured target, not proof that a request occurred at runtime.
