# Incident and Rollback Runbook

## Immediate Actions

1. Stop current rollout and freeze merges to `main`.
2. Confirm failing workflow, scope, and blast radius.
3. Re-run failing checks with verbose logs.

## Rollback

1. Revert the release commit/PR on `main`.
2. Trigger production workflow with approved rollback.
3. Validate `npx firestack test --ci --profile production`.

## Follow-up

1. Document root cause and timeline.
2. Add/adjust tests to prevent recurrence.
3. Promote fix from `develop` after staging validation.
