# IRONLOG v2 - Mining ERP Platform

[![CI Smoke](https://github.com/YOUR_ORG/YOUR_REPO/actions/workflows/ci-smoke.yml/badge.svg?branch=main)](https://github.com/YOUR_ORG/YOUR_REPO/actions/workflows/ci-smoke.yml)

IRONLOG is a full-site ERP platform designed for mining operations with integrated modules for:

- Plant: maintenance, service intervals, fuel usage, availability/utilization, MTBF, MTTR, auto work orders
- Operations: tonnes hauled, drilling/blasting costs, material produced, client load tracking, fuel costing
- HSE: incidents, observations, actions, compliance workflows
- HR: employee records, shifts, training, attendance, leave, competencies
- Quality: grading, QA documentation, sampling, audit trails
- Logistics: cargo status, trip planning, supply chain visibility
- Ironmind AI: document generation, recurring fault detection, proactive alerts

## Proposed Stack

- Frontend: React + Vite + TypeScript
- API: Node.js + Express + TypeScript
- Database: PostgreSQL
- Cache/Queue: Redis
- Hosting: Hetzner (Docker), Cloudflare (edge/WAF/DNS), Tailscale (secure admin)
- AI: OpenAI integration for document drafting and fault intelligence

## Monorepo Structure

- apps/api: backend services and ERP modules
- apps/web: dashboard and operational UI
- infra: deployment and infrastructure configuration

## Quick Start

1. Copy environment values:
   - `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`)
2. Start core dependencies:
   - `docker compose up -d postgres redis`
   - PostgreSQL host port is `5433` by default to avoid local conflicts
3. Run API:
   - `cd apps/api`
   - `npm install`
   - `npm run db:migrate`
   - `npm run db:seed`
   - `npm run dev`
4. Run Web:
   - `cd apps/web`
   - `npm install`
   - `npm run dev`

## What Is Implemented Now

- Domain-based API skeleton for all requested modules
- KPI computation endpoints for maintenance and utilization
- Weekly report generation endpoint placeholders (including GM excel export contract)
- AI service endpoints for document drafting and recurring fault alerts
- PostgreSQL schema and seed scripts with JWT authentication and RBAC permissions
- Frontend operations command center scaffold with live KPI cards and module routing
- Docker compose dependencies (PostgreSQL + Redis)
- Department data dump endpoints for Operations, HSE, HR, Quality, and Logistics

## Authentication

- Login endpoint: `POST /api/auth/login`
- Refresh endpoint: `POST /api/auth/refresh`
- Logout endpoint: `POST /api/auth/logout`
- Protected profile endpoint: `GET /api/auth/me`
- Most module routes now require bearer auth and role permissions.

### Auth Hardening

- IP-based login rate limiting via `LOGIN_RATE_LIMIT_WINDOW_MS` and `LOGIN_RATE_LIMIT_MAX`
- Account lockout after repeated failures via `LOGIN_MAX_ATTEMPTS` and `LOGIN_LOCKOUT_MINUTES`
- Refresh token rotation with revocation support
- In production, `JWT_SECRET` must be non-default and at least 32 characters

## Health Endpoints

- `GET /health` basic API status
- `GET /health/startup` startup and dependency health (PostgreSQL + Redis)
- `GET /health/ui` browser-ready status page with dependency badges

`/health/startup` returns HTTP `200` when all dependencies are reachable and `503` when degraded.

## Department Data Dumps

The API now provides dataset-style payloads (not only summary cards) for each department:

- `GET /api/operations/dump`
- `GET /api/hse/dump`
- `GET /api/hr/dump`
- `GET /api/quality/dump`
- `GET /api/logistics/dump`

The web command center renders these under **All Departments Data Dump**.

## Enterprise Scale Lab

Admin-only enterprise endpoints:

- `GET /api/enterprise/overview?hours=168`
- `POST /api/enterprise/synthetic-load`
- `GET /api/enterprise/synthetic-load/runs`
- `GET /api/enterprise/export-bundle?hours=168&siteCode=SITE-A`

`synthetic-load` lets you bulk-generate realistic cross-department data for stress-testing:

- equipment hours
- fuel entries
- fault events (optional critical spike)

The web dashboard includes an **Enterprise Scale Lab** panel to run generators and refresh a unified enterprise KPI snapshot.

### Multi-Site and Scheduled Synthetic Jobs

Synthetic generation supports site scoping using machine code prefixes (`SITE-A-EQ-1001` style).

Optional scheduler settings in `.env`:

- `SYNTHETIC_LOAD_CRON` (example: `0 3 * * *`, set `off` or empty to disable)
- `SYNTHETIC_LOAD_DEFAULT_SITE_CODE` (example: `SITE-A`)
- `SYNTHETIC_LOAD_DEFAULT_DAYS` (default `7`)
- `SYNTHETIC_LOAD_DEFAULT_MACHINES` (comma-separated)
- `SYNTHETIC_LOAD_DEFAULT_EVENTS_PER_DAY_PER_MACHINE` (default `3`)
- `SYNTHETIC_LOAD_DEFAULT_INCLUDE_CRITICAL_SPIKE` (`true`/`false`)

The export bundle endpoint returns both:

- JSON snapshot payloads per department + enterprise overview
- CSV strings for one-click downstream analysis/import

### Phase 3 Tenancy, Trends, and Artifact Storage

New platform capabilities:

- Site registry and access assignment:
   - `GET /api/sites`
   - `POST /api/sites`
   - `POST /api/sites/:siteId/access`
- Site-scoped enterprise trends:
   - `GET /api/enterprise/trends?hours=168&siteCode=SITE-A&bucketHours=24`
- Persisted export artifacts with download:
   - `POST /api/enterprise/export-bundle/persist`
   - `GET /api/enterprise/export-artifacts?siteCode=SITE-A`
   - `GET /api/enterprise/export-artifacts/:id/download`

Export artifacts are stored under `apps/api/reports/exports` and old artifacts are pruned automatically (14-day retention) during new persist operations.

### Phase 4 to 6 Expansion

New capabilities delivered:

- Site-aware access UX:
   - Site registry and assignment endpoints used by UI dropdown workflows
   - No manual raw UUID entry required in normal admin flow
- Signed artifact download links:
   - `POST /api/enterprise/export-artifacts/:id/token`
   - `GET /api/enterprise/export-artifacts/token/:token/download`
   - token is single-use and time-limited
- Cross-site executive comparison:
   - `GET /api/enterprise/cross-site-comparison?hours=168`
   - returns per-site KPI variance for heatmap-style ranking
- Enterprise trend endpoint:
   - `GET /api/enterprise/trends?hours=168&siteCode=SITE-A&bucketHours=24`

The web **Enterprise Scale Lab** now includes cross-site variance heat table, trend spark charts, persisted artifact actions, and token-link generation.

### Phase 7 Expansion

New capabilities delivered:

- Route-isolated command center sections:
   - `Overview`, `Ironmind`, `Departments`, `Enterprise`, and `Admin` are rendered from a single section router
   - users can jump sections via **Site Route Control**
- Site-role section guards:
   - section availability is computed from site role and permissions
   - blocked sections are disabled in navigation and not rendered in the main body
- Restored full gated panels:
   - **Departments** section now includes Operations, HSE, HR, Quality, and Logistics data tables
   - **Enterprise** section now includes synthetic generation, site/access management, cross-site heat, trends, and artifact actions
   - full **RBAC Admin Console** is only rendered in the `Admin` section for authorized users

### Phase 8 Expansion

New capabilities delivered:

- Digital work order lifecycle:
   - create, assign, progress, request approval, approve, and close work orders
   - work order event timeline for auditability
- Shift command board:
   - backlog by status, overdue jobs, blocked jobs, pending approvals, and assignee load
- Cost and downtime attribution:
   - machine-level and department-level rollups over configurable time windows
- Supervisor approval workflow:
   - high-risk orders can move through `pending_approval` and `approved` before closure
- Role scorecards:
   - operator/supervisor/executive scorecard cards generated from site execution data

New API endpoints:

- Work order register:
   - `GET /api/work-orders?siteCode=SITE-A&status=open&limit=80`
   - `POST /api/work-orders`
   - `PATCH /api/work-orders/:id`
   - `GET /api/work-orders/:id/events`
- Approval and closeout:
   - `POST /api/work-orders/:id/request-approval`
   - `POST /api/work-orders/:id/approve`
   - `POST /api/work-orders/:id/close`
- Command and analytics:
   - `GET /api/work-orders/board/shift?siteCode=SITE-A`
   - `GET /api/work-orders/attribution/cost-downtime?siteCode=SITE-A&hours=168`
   - `GET /api/work-orders/scorecard/role?siteCode=SITE-A&days=30`

The web **Enterprise Scale Lab** now includes an **Execution Control Loop** panel with digital work order forms, supervisor actions, shift board tables, and live attribution views.

### Phase 9 Expansion

New capabilities delivered:

- Auto SLA breach alerts and escalations:
   - configurable SLA rules by site, priority, and department
   - scheduler-driven SLA evaluation and manual trigger endpoint
   - escalation events persisted with delivery status and escalation payload
   - Teams/WhatsApp retry queue with capped exponential backoff
- Evidence and photo attachment flow:
   - upload base64 attachments to work orders with metadata and notes
   - MIME hardening (jpeg/png/webp/pdf/txt/xlsx) and image pre-upload preview in web UI
   - attachment table plus secure download endpoint
- Executive shift PDF report:
   - generates a downloadable PDF from shift board backlog, scorecard, and attribution snapshots
   - report is stored as an export artifact and can be downloaded via secured route
   - scheduled dispatch to executive distribution list via email

New API endpoints:

- SLA rules and escalation run:
   - `GET /api/work-orders/sla-rules?siteCode=SITE-A`
   - `POST /api/work-orders/sla-rules`
   - `PATCH /api/work-orders/sla-rules/:id`
   - `POST /api/work-orders/sla-evaluate/run`
   - `GET /api/work-orders/escalations?siteCode=SITE-A&limit=100`
   - `POST /api/work-orders/escalations/retry-run`
- Evidence attachments:
   - `POST /api/work-orders/:id/attachments`
   - `GET /api/work-orders/:id/attachments`
   - `GET /api/work-orders/:id/attachments/:attachmentId/download`
- Executive PDF report:
   - `POST /api/work-orders/reports/executive/pdf`
   - `POST /api/work-orders/reports/executive/pdf/dispatch`
   - `GET /api/work-orders/reports/executive/pdf/:id/download`

Scheduler config:

- `WORK_ORDER_SLA_CRON=*/20 * * * *`
   - set to `off` to disable automatic SLA evaluations
- `WORK_ORDER_ESCALATION_RETRY_CRON=*/5 * * * *`
   - set to `off` to disable escalation retry runner
- `EXECUTIVE_SHIFT_REPORT_CRON=0 5 * * *`
   - set to `off` to disable scheduled executive report dispatch
- `EXECUTIVE_SHIFT_REPORT_DEFAULT_SITE_CODE=SITE-A`
- `EXECUTIVE_SHIFT_REPORT_RECIPIENTS=gm@ironlog.local,ops.manager@ironlog.local`

### Phase 10 Expansion

New capabilities delivered:

- Asana-style workflow board:
   - site-wide board grouped into workflow lanes (`open`, `assigned`, `in_progress`, `blocked`, `pending_approval`, `approved`, `closed`)
   - lane cards include live counts and latest work-order snapshots for operations triage
- Work-order checklist collaboration:
   - add execution checklist items with optional assignee and due date
   - mark checklist items complete/incomplete for structured closeout discipline
- Work-order comments stream:
   - append operator/supervisor comments directly on each order
   - query recent comment history for shift handover context
- Cross-work-order dependencies:
   - link blocked orders to upstream prerequisite work orders
   - remove dependencies when prerequisite tasks are resolved

New API endpoints:

- Workflow board:
   - `GET /api/work-orders/workflow/board?siteCode=SITE-A&limit=200`
- Checklist:
   - `GET /api/work-orders/:id/checklist`
   - `POST /api/work-orders/:id/checklist`
   - `PATCH /api/work-orders/:id/checklist/:itemId`
- Comments:
   - `GET /api/work-orders/:id/comments?limit=100`
   - `POST /api/work-orders/:id/comments`
- Dependencies:
   - `GET /api/work-orders/:id/dependencies`
   - `POST /api/work-orders/:id/dependencies`
   - `DELETE /api/work-orders/:id/dependencies/:dependsOnId`

The web **Enterprise Scale Lab** now includes an **Asana-Style Workflow** panel with board lanes, per-order checklist controls, collaboration comments, and dependency management actions.

Sample request bodies:

- `POST /api/work-orders/:id/checklist`
```json
{
   "title": "Verify lockout-tagout before repair",
   "assigneeName": "Operator B",
   "dueAt": "2026-04-06T08:00:00Z"
}
```
- `PATCH /api/work-orders/:id/checklist/:itemId`
```json
{
   "status": "done"
}
```
- `POST /api/work-orders/:id/comments`
```json
{
   "message": "Dependency created, waiting on parent completion."
}
```
- `POST /api/work-orders/:id/dependencies`
```json
{
   "dependsOnWorkOrderId": 123
}
```

## Request Logging and Correlation IDs

- Every API request now gets a correlation ID via `x-correlation-id`
- If a client provides `x-correlation-id`, it is reused and propagated in the response
- Structured request logs are emitted as one JSON line per request with:
   - `correlationId`
   - HTTP method/path/status
   - request duration in milliseconds
   - client IP and authenticated `userId` when available

Use this ID to trace a single request through reverse proxies, API logs, and incident reports.

## RBAC Admin API

All admin endpoints require `system.admin` permission.

- `GET /api/admin/rbac/summary` - users, roles, and permissions in one payload
- `GET /api/admin/rbac/audit?limit=50` - latest RBAC admin actions
- `POST /api/admin/rbac/users` - create/update user and assign initial roles
- `POST /api/admin/rbac/users/:userId/roles` - replace assigned roles for a user
- `POST /api/admin/rbac/roles` - create role and assign initial permissions
- `POST /api/admin/rbac/roles/:roleId/permissions` - replace permissions for a role

The web command center includes an RBAC Admin Console panel after login for these actions and a live audit trail table.

## Mass Import API (Admin)

All import endpoints require `system.admin` permission and accept either `csv` or `rows` payload.

- `POST /api/admin/import/assets`
- `POST /api/admin/import/fuel`
- `POST /api/admin/import/stores`
- `POST /api/admin/import/hours`

### CSV Headers

- Assets: `assetCode,name,category,status,location`
- Fuel: `entryDate,machineCode,liters,unitCost,totalCost,sourceRef`
- Stores: `itemCode,name,unit,currentStock,reorderLevel,location`
- Hours: `entryDate,machineCode,shiftName,operatorName,hoursRun,hoursAvailable`

Header names are normalized so `entry_date`, `Entry Date`, and `entryDate` all map correctly.

### Admin Console File Upload

In the RBAC Admin Console > Mass Import section you can now:

- Drag and drop `.csv`, `.xlsx`, or `.xls` files per dataset
- Select files via file picker
- Continue using direct CSV paste if preferred

The first worksheet in an Excel workbook is imported.

## Automation and Alerts

### Weekly GM Report Automation

- Scheduled by cron expression in `WEEKLY_REPORT_CRON` (default Monday 06:00)
- Manual trigger: `POST /api/admin/automation/weekly-gm/run`
- Recent runs: `GET /api/admin/automation/weekly-gm/runs`
- Generates XLSX into `apps/api/reports` and emails recipient configured by `WEEKLY_REPORT_RECIPIENT`

### Recurring Fault Notification Engine

- Create/list rules:
   - `POST /api/admin/automation/fault-rules`
   - `GET /api/admin/automation/fault-rules`
- Manage rules:
   - `PATCH /api/admin/automation/fault-rules/:id`
   - `POST /api/admin/automation/fault-rules/:id/disable`
   - `DELETE /api/admin/automation/fault-rules/:id`
- Submit fault events:
   - `POST /api/ironmind/faults/events`
- View triggered notifications:
   - `GET /api/ironmind/faults/notifications`

### Ironmind Live Stream and Case Ops

- WebSocket stream (auth token query parameter): `/ws/ironmind`
- Event types:
   - `fault_event_created`
   - `investigation_case_updated`
- Investigation endpoints:
   - `GET /api/ironmind/cases`
   - `POST /api/ironmind/cases`
   - `GET /api/ironmind/cases/:caseId`
   - `POST /api/ironmind/cases/:caseId/actions`
   - `PATCH /api/ironmind/cases/:caseId/actions/:actionId`
   - `POST /api/ironmind/cases/:caseId/close`
- Predictive endpoint:
   - `GET /api/ironmind/intel/predictive?horizonHours=72&windowHours=336`

In the web UI you can now:

- Enable/disable critical sound alarms
- Mute alerts for 10 or 30 minutes
- Acknowledge individual toast alerts
- See per-machine realtime event counters

Rule fields:

- `occurrenceThreshold`
- `windowHours`
- `channel` (`email`, `teams_webhook`, `whatsapp_webhook`)
- `recipient` (email address or webhook URL based on channel)

### Mobile Operator Capture

- Save field entry: `POST /api/plant/operator-entries`
- Fetch recent entries: `GET /api/plant/operator-entries?limit=20`

Operator capture stores hours data and optional fuel liters per machine/day.

The web mobile capture panel also supports offline queueing:

- If API/network is unavailable, entries are queued in browser local storage
- Queue is synced automatically when the browser comes back online
- Manual sync button is available in the operator panel

### Default Seed Admin

- Email: `admin@ironlog.local`
- Password: `ChangeMe123!`
- Override with `ADMIN_EMAIL` and `ADMIN_PASSWORD` before running `npm run db:seed`.

## Database Backup and Restore

PowerShell scripts are included under `scripts/` for PostgreSQL dump/restore against the dockerized DB.

### Create Backup

- Command: `npm run backup:db`
- Output: timestamped `.dump` files in `./backups`
- Default retention: 14 days (old files are pruned)

Optional parameters:

- `-ContainerName ironlog-postgres-alt`
- `-DbName ironlog`
- `-DbUser ironlog`
- `-DbPassword ironlog`
- `-OutputDir ./backups`
- `-RetentionDays 14`

Example:

- `powershell -ExecutionPolicy Bypass -File ./scripts/db-backup.ps1 -RetentionDays 30`

### Restore Backup

- Command helper: `npm run restore:db -- -BackupFile ./backups/ironlog-YYYYMMDD-HHMMSS.dump`

Example direct command:

- `powershell -ExecutionPolicy Bypass -File ./scripts/db-restore.ps1 -BackupFile ./backups/ironlog-20260101-060000.dump`

Restore behavior:

- Uses `pg_restore --clean --if-exists`
- Drops and recreates objects from the backup in target DB
- Should be run against maintenance windows or non-production targets first

### Automate Daily Backup (Windows Task Scheduler)

Use Task Scheduler to run daily at 06:00:

1. Program/script: `powershell.exe`
2. Add arguments: `-ExecutionPolicy Bypass -File "c:\IRONLOG v2\scripts\db-backup.ps1"`
3. Start in: `c:\IRONLOG v2`

This creates one backup per day and applies retention cleanup automatically.

## Smoke Test Script

Use the startup smoke test to validate API readiness after deploys or restarts.

- Command: `npm run smoke:test`
- Checks:
   - `GET /health/startup`
   - `POST /api/auth/login`
   - `GET /api/plant/kpis` (protected endpoint)

Optional parameters:

- `-ApiBase http://localhost:4000`
- `-Email admin@ironlog.local`
- `-Password ChangeMe123!`

Example:

- `powershell -ExecutionPolicy Bypass -File ./scripts/smoke-test.ps1 -ApiBase http://localhost:4000`

## Workflow Smoke Test Script

Use the workflow smoke test to validate checklist/comment/dependency board flows after deploys.

- Command: `npm run smoke:workflow`
- Checks:
   - `GET /health/startup`
   - `POST /api/work-orders`
   - `POST /api/work-orders/:id/checklist`
   - `PATCH /api/work-orders/:id/checklist/:itemId`
   - `POST /api/work-orders/:id/comments`
   - `POST /api/work-orders/:id/dependencies`
   - `GET /api/work-orders/workflow/board`

Example:

- `powershell -ExecutionPolicy Bypass -File ./scripts/workflow-smoke-test.ps1 -ApiBase http://localhost:4000 -SiteCode SITE-A`

## Roadmap

1. Database schema and migrations for production entities
2. Event-driven work order and alert generation
3. Real-time telemetry ingestion from equipment/IoT
4. Advanced analytics: MTBF/MTTR trends, predictive failures, cost anomalies
5. RBAC, audit logging, and compliance hardening
6. Production deployment automation to Hetzner + Cloudflare + Tailscale admin plane
