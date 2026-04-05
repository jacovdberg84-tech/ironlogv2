# Release Hardening Checklist

## Branch Protection

1. Protect `main`
2. Require pull request review before merge
3. Require status checks to pass:
   - `CI Smoke / Build`
   - `CI Smoke / Startup Smoke`
   - `CI Smoke / Workflow Smoke`
4. Block force pushes and branch deletion

## GitHub Environments

1. Create environments:
   - `staging`
   - `production`
2. Configure required reviewers for `production`
3. Add environment secrets:
   - `DEPLOY_WEBHOOK_URL`
   - `DEPLOY_WEBHOOK_TOKEN`

## Repository Secrets

1. Add `OPENAI_API_KEY` if non-mock calls are used in deploy/runtime workflows
2. Add SMTP secrets for report dispatch if required by deployment target
3. Rotate credentials quarterly

## Deployment Flow

1. Open Actions and run `Deploy Release`
2. Select `environment` and `ref`
3. Confirm environment approval gate in GitHub UI
4. Verify deploy logs and downstream target health

## Rollback

1. Re-run `Deploy Release` with previous known-good ref
2. Validate startup and workflow smoke checks post-rollback

## Backup Assurance

1. Confirm `IRONLOG Daily DB Backup` task is enabled
2. Confirm latest dump exists under `backups/`
3. Test restore monthly with `npm run restore:db`
