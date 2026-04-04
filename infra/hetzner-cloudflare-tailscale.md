# Hetzner + Cloudflare + Tailscale Deployment Blueprint

## Target Topology

- Hetzner VM hosts Dockerized services
- Cloudflare provides DNS, TLS, WAF, and caching edge
- Tailscale secures internal admin endpoints and SSH access

## Recommended VM Layout

- `ironlog-app-01` (public): reverse proxy + web + api
- `ironlog-db-01` (private): PostgreSQL + Redis
- Optional `ironlog-worker-01`: queue workers and report generation

## Security Controls

- Enforce Cloudflare proxy mode for public domains
- Allow SSH from Tailscale network only
- Keep API admin routes behind Tailscale ACLs
- Use Cloudflare WAF managed rules and bot protection

## Domains

- `erp.yourdomain.com` -> Web UI
- `api.yourdomain.com` -> API gateway
- `admin.yourdomain.com` -> optional internal portal (Tailscale restricted)

## Secrets

- Store OpenAI key and DB credentials as runtime environment variables
- Rotate secrets monthly
- Enable database backups and point-in-time restore policies

## High Availability Path

1. Add read replica for PostgreSQL
2. Add second app VM behind Cloudflare Load Balancer
3. Introduce managed message queue for async workloads
4. Enable centralized logging and uptime probes
