# Local and ECS Release Workflow

This repository uses one shared Next.js codebase with two independent
environments. Local development never changes the public ECS deployment by
itself.

## Environment boundary

| Environment | Git branch | Environment file | Runtime |
| --- | --- | --- | --- |
| Local macOS development | `main` | `.env.local` | `npm run dev` |
| Alibaba Cloud ECS production | `release` | `.env.production.local` | PM2 and `next start` |

Neither environment file is committed. The checked-in `.env.example` and
`.env.production.example` files contain variable names and documentation only.

`main` is the active development branch. `release` is the only branch approved
for ECS. There is no webhook, GitHub Actions workflow, CI/CD pipeline, or
automatic deployment. Pushing `main` does not update `release`, and ECS never
fetches or deploys `main`.

## Local development

The Git repository root and application directory are different:

```text
/Users/youming/Documents/GI deskilling/
/Users/youming/Documents/GI deskilling/colonoscopy-assessment-platform/
```

Create the ignored local environment file:

```bash
cd "/Users/youming/Documents/GI deskilling/colonoscopy-assessment-platform"
cp .env.example .env.local
chmod 600 .env.local
```

Set the existing Supabase URL and publishable key. The service-role key is
optional and is only for trusted local upload tooling; it must never be exposed
through a `NEXT_PUBLIC_...` variable.

Start local development from `main`:

```bash
cd "/Users/youming/Documents/GI deskilling"
git switch main
cd colonoscopy-assessment-platform
npm ci
npm run dev
```

`VIDEO_SOURCE_MODE=local` is reserved for possible future work. It is not
implemented by this release workflow; the current application still uses
private Supabase Storage.

## Release branch baseline

The production branch starts from the currently deployed known-good commit:

```text
d4957edd455e7f99bc71cbde09c23254edabcfac
```

Verify the local and remote release references before promoting anything:

```bash
cd "/Users/youming/Documents/GI deskilling"
git fetch origin release
git rev-parse release
git rev-parse origin/release
```

## Promotion preflight

Only committed and explicitly approved changes may be promoted. Before either
promotion method:

1. Review the commits and changed files being promoted.
2. Push the tested development commits to `origin/main`.
3. Build and test the exact approved commit in a temporary worktree.
4. Do not force-push `release`.
5. Do not log in to ECS until the remote `release` commit has been verified.

## Fast-forward promotion

Use fast-forward promotion only when every commit from the current `release`
tip through the selected `main` commit is approved for production.

Select and validate the exact approved commit:

```bash
cd "/Users/youming/Documents/GI deskilling"
git fetch origin main release
read -r -p "Approved main commit SHA: " APPROVED_SHA
APPROVED_SHA="$(git rev-parse "$APPROVED_SHA^{commit}")"
git show --no-patch --oneline "$APPROVED_SHA"
git merge-base --is-ancestor "$APPROVED_SHA" origin/main
git merge-base --is-ancestor origin/release "$APPROVED_SHA"
```

Verify that exact commit without changing the active development checkout:

```bash
VERIFY_DIR="$(mktemp -d /tmp/deskilling-release-verify.XXXXXX)"
git worktree add --detach "$VERIFY_DIR" "$APPROVED_SHA"
cd "$VERIFY_DIR/colonoscopy-assessment-platform"
npm ci
npm run typecheck
npm test
npm run build
cd "/Users/youming/Documents/GI deskilling"
git worktree remove "$VERIFY_DIR"
```

Promote with a non-forced fast-forward push and synchronize the local release
reference:

```bash
git push origin "$APPROVED_SHA:refs/heads/release"
git fetch origin release
git branch -f release origin/release
git rev-parse release
git rev-parse origin/release
```

The push fails safely if the remote branch cannot be fast-forwarded.

## Selective cherry-pick promotion

Use selective promotion when only specific commits from `main` are approved.
Create the release commit in a temporary worktree so the active `main` checkout
and its uncommitted local work remain untouched:

```bash
cd "/Users/youming/Documents/GI deskilling"
git fetch origin main release
PROMOTION_DIR="$(mktemp -d /tmp/deskilling-release-promotion.XXXXXX)"
git worktree add --detach "$PROMOTION_DIR" origin/release
cd "$PROMOTION_DIR"
git cherry-pick <APPROVED_COMMIT_SHA_1> <APPROVED_COMMIT_SHA_2>
```

Review and verify the candidate:

```bash
git log --oneline origin/release..HEAD
git diff --stat origin/release..HEAD
cd colonoscopy-assessment-platform
npm ci
npm run typecheck
npm test
npm run build
```

Push the verified candidate and update the local release reference:

```bash
cd "$PROMOTION_DIR"
git push origin HEAD:refs/heads/release
cd "/Users/youming/Documents/GI deskilling"
git fetch origin release
git branch -f release origin/release
git worktree remove "$PROMOTION_DIR"
git rev-parse release
git rev-parse origin/release
```

If a cherry-pick or verification fails, run `git cherry-pick --abort` inside the
temporary worktree, remove the worktree, and leave `origin/release` unchanged.

## ECS deployment and rollback

Promoting `release` does not update ECS. Production changes only after an
administrator explicitly logs in and runs the deployment sequence in
[`alibaba-ecs-deployment.md`](alibaba-ecs-deployment.md).

The ECS checkout remains in the single directory
`/var/www/deskilling/colonoscopy-assessment-platform`. The workflow does not use
immutable release directories or a `current` symlink.
