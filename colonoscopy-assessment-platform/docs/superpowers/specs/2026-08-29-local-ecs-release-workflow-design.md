# Local Development and ECS Release Workflow Design

## Goal

Maintain one shared application codebase with two independent deployment
environments:

- Local development on macOS uses `main` and never changes the public site by
  itself.
- Alibaba Cloud ECS production uses `release` and changes only after an
  explicit, manually approved promotion and deployment.

This design does not change study logic, Supabase, private video Storage, or
video-source behavior.

## Repository layout

The Git repository root is the `deskilling` repository:

```text
/Users/youming/Documents/GI deskilling/
```

The Next.js application is a tracked subdirectory:

```text
colonoscopy-assessment-platform/
```

The GitHub remote is:

```text
https://github.com/xuyouming2101-byte/deskilling.git
```

ECS uses this simple working directory:

```text
/var/www/deskilling/colonoscopy-assessment-platform
```

The ECS repository checkout is therefore `/var/www/deskilling`, while all npm,
Next.js, PM2, and application health commands run from its
`colonoscopy-assessment-platform` subdirectory.

## Branch roles

### `main`

- Active local development and feature iteration.
- May contain work that is not approved for public deployment.
- Pushing `main` never changes ECS.
- ECS must not track, pull, merge, or deploy `main`.

### `release`

- The only ECS production branch.
- Initially points to the known-good deployment preparation commit
  `d4957edd455e7f99bc71cbde09c23254edabcfac`.
- Changes only through an explicit manual promotion.
- Has no webhook, GitHub Actions workflow, or automatic deployment trigger.

## Environment separation

### Local development

Local development runs from `main` with:

```text
colonoscopy-assessment-platform/.env.local
```

The file is ignored by Git. It contains the browser publishable Supabase values
needed by the current application. `SUPABASE_SERVICE_ROLE_KEY` may be present
only when the trusted local upload script is used; it must never be renamed to a
`NEXT_PUBLIC_*` variable.

Local development starts with:

```bash
cd "/Users/youming/Documents/GI deskilling/colonoscopy-assessment-platform"
npm run dev
```

`VIDEO_SOURCE_MODE=local` is reserved for a future feature. It is not added or
documented as active configuration until the application actually implements
that mode.

### ECS production

ECS runs from `release` with:

```text
/var/www/deskilling/colonoscopy-assessment-platform/.env.production.local
```

The file is ignored by Git and contains only:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

ECS does not receive `SUPABASE_SERVICE_ROLE_KEY`. The existing Supabase Edge
Function continues to own its platform-provided service-role credential.

## Manual promotion

A promotion selects committed, reviewed, and tested code from `main` for the
`release` branch. Uncommitted working-tree changes can never be promoted.

### Preferred fast-forward promotion

Use fast-forward promotion when the approved `main` commit includes every
earlier commit that should also be released:

1. Identify the approved commit SHA on `main`.
2. Verify it is present on `origin/main`.
3. Verify `origin/release` is an ancestor of the approved SHA.
4. Run typecheck, tests, and production build for that exact SHA.
5. Push the approved SHA to `release` without force.

This advances `release` while preserving a linear shared history.

### Selective cherry-pick promotion

Use cherry-pick only when specific approved commits must be promoted while other
`main` commits remain unreleased:

1. Create a temporary Git worktree from `origin/release`.
2. Cherry-pick only the explicitly approved commits in dependency order.
3. Resolve conflicts without copying unrelated working-tree changes.
4. Run typecheck, tests, and production build in the temporary worktree.
5. Push its HEAD to `release` without force.
6. Remove the temporary worktree only after the push is verified.

Cherry-pick promotion creates release-only commit SHAs and is an exception, not
the default workflow.

## ECS initial checkout

The initial ECS clone checks out only `release`:

```bash
cd /var/www
git clone --branch release --single-branch \
  https://github.com/xuyouming2101-byte/deskilling.git deskilling
cd /var/www/deskilling
git branch --show-current
git status --short
```

The branch command must print `release`, and the working tree must be clean.

## ECS manual update

Before every deployment, record the currently deployed commit:

```bash
cd /var/www/deskilling
git rev-parse HEAD | tee "$HOME/deskilling-previous-release"
git status --short
```

Stop if the working tree is not clean. Then update only from `origin/release`:

```bash
git fetch origin
git switch release
git pull --ff-only origin release
git branch --show-current
git rev-parse HEAD
```

From the application subdirectory, install and verify before restarting PM2:

```bash
cd /var/www/deskilling/colonoscopy-assessment-platform
npm ci
npm run typecheck
npm test
npm run build
pm2 restart ecosystem.config.cjs --update-env
pm2 status
```

No restart occurs if dependency installation, typecheck, tests, or build fails.
Because this simplified workflow builds in the active directory, deployment is
performed during a controlled maintenance window.

## Post-deployment verification

Each deployment requires all of the following:

1. PM2 reports `colonoscopy-assessment` as online.
2. `http://127.0.0.1:3000/` returns HTTP 200 from the ECS host.
3. The Nginx route returns HTTP 200.
4. The public browser page loads without a Supabase configuration error.
5. A clearly labelled DEV smoke-test participant can load its queue.
6. A current private Supabase video obtains a signed URL and plays.
7. One test response saves successfully and advances to the next queued video.

The smoke-test participant ID is recorded so its database rows remain
identifiable.

## Rollback

Rollback uses the previously recorded known-good release commit or an explicitly
selected release tag. It never checks out `main`:

```bash
cd /var/www/deskilling
PREVIOUS_RELEASE="$(cat "$HOME/deskilling-previous-release")"
git show --no-patch --oneline "$PREVIOUS_RELEASE"
git switch --detach "$PREVIOUS_RELEASE"
```

Rebuild and restart from the application subdirectory:

```bash
cd /var/www/deskilling/colonoscopy-assessment-platform
npm ci
npm run build
pm2 restart ecosystem.config.cjs --update-env
pm2 status
```

Run the same HTTP, Supabase, signed-video, and response smoke tests. After the
incident is resolved, return the checkout to the production branch without
advancing it:

```bash
cd /var/www/deskilling
git switch release
```

The failed release remains in Git history for diagnosis. Rollback does not
force-push or rewrite `release`.

## Documentation and configuration changes

Implementation is limited to deployment workflow material:

- Clarify local-only use in `.env.example`.
- Clarify ECS-only use in `.env.production.example`.
- Add a release workflow guide with exact promotion commands.
- Correct `docs/alibaba-ecs-deployment.md` to use the repository root,
  application subdirectory, and `release` branch.
- Add short references in `README.md`.
- Create and push `release` at `d4957ed` after the workflow files are reviewed.

No files under `app/`, `components/`, `lib/`, or `supabase/` are modified.

## Acceptance criteria

- Local development remains on `main` and continues to use `.env.local`.
- Remote `release` exists and initially resolves to `d4957ed`.
- No CI/CD or automatic deployment configuration exists.
- ECS instructions clone and pull only `release`.
- ECS commands use `/var/www/deskilling/colonoscopy-assessment-platform`.
- Production environment files remain untracked.
- Promotion is manual, non-force, and verified before updating `release`.
- Rollback never uses `main` and preserves the failed release history.
- Existing typecheck, tests, and production build pass without study-logic
  changes.
