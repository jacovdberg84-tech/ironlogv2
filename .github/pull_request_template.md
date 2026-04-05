## Summary

Describe what changed and why.

## Validation

- [ ] `npm --workspace apps/api run build`
- [ ] `npm --workspace apps/web run build`
- [ ] `npm run smoke:test`
- [ ] `npm run smoke:workflow`

## Risk Review

- [ ] Migration changes reviewed
- [ ] Backward compatibility considered
- [ ] Rollback approach documented

## Security and Secrets

- [ ] No secrets committed
- [ ] Environment variables documented in `.env.example`
- [ ] Auth and permission impacts reviewed

## Release Notes

Include user-facing or ops-facing notes, if applicable.
