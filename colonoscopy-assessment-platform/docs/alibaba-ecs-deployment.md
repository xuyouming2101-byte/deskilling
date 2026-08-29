# Alibaba Cloud ECS Deployment

This guide deploys the current Next.js application to Ubuntu 22.04 on Alibaba
Cloud ECS. Supabase remains the database, RPC, Edge Function, and private video
Storage provider. This workflow does not use Alibaba Cloud RDS or OSS and does
not introduce automatic deployment.

## Production boundary

The ECS deployment has one checkout and one application directory:

```text
Git checkout: /var/www/deskilling
Next.js app:   /var/www/deskilling/colonoscopy-assessment-platform
Git branch:    release
Environment:   .env.production.local
```

ECS must track only `origin/release`. It must never deploy `main`. Pushing or
testing changes on `main` has no effect on the running public application until
those changes are manually promoted to `release` and then manually deployed on
ECS.

## Architecture and ports

```text
Browser -> ECS port 80 -> Nginx -> 127.0.0.1:3000 -> Next.js
Browser -> HTTPS -> existing Supabase API, Edge Function, and signed video URL
```

Configure the ECS security group as follows:

- Allow inbound TCP port 22 only from trusted administrator IP addresses.
- Allow inbound TCP port 80 for the current HTTP deployment.
- Reserve inbound TCP port 443 for a later domain and HTTPS deployment.
- Do not open inbound TCP port 3000. Next.js binds only to `127.0.0.1:3000`.
- Keep outbound HTTPS access available for Git, npm, and Supabase.

## 1. Install Ubuntu packages

Log in with an Ubuntu user that has `sudo` access:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx
```

Install Node.js 22 LTS from NodeSource, then verify it:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
node --version
npm --version
```

The Node.js version must be 22.x. Install PM2 globally and enable Nginx:

```bash
sudo npm install -g pm2
pm2 --version
git --version
nginx -v
sudo systemctl enable --now nginx
```

## 2. Clone only the release branch

For a new server, clone the repository into the fixed deployment directory:

```bash
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
cd /var/www
git clone --branch release --single-branch \
  https://github.com/xuyouming2101-byte/deskilling.git deskilling
cd /var/www/deskilling
```

Verify that the checkout and fetch configuration are release-only:

```bash
git branch --show-current
git status --short
git config --get-all remote.origin.fetch
git rev-parse HEAD
```

The branch must be `release`, the working tree must be clean, and the fetch
refspec should name `refs/heads/release`. Do not add `main` to this checkout.

## 3. Configure the production environment

Create the ignored production-local environment file inside the application
directory:

```bash
cd /var/www/deskilling/colonoscopy-assessment-platform
cp .env.production.example .env.production.local
chmod 600 .env.production.local
nano .env.production.local
```

Set exactly these browser-safe values using the existing Supabase project:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Do not add `SUPABASE_SERVICE_ROLE_KEY` to the ECS Next.js environment. It is a
secret for trusted server-side Supabase tooling and must never be renamed to a
`NEXT_PUBLIC_...` variable.

Next.js embeds `NEXT_PUBLIC_...` values during `npm run build`, so rebuild after
changing either value. `.env.production.local` is ignored by Git and must remain
server-local.

## 4. Initial build and start

Install exact dependencies, verify the application, and build it:

```bash
cd /var/www/deskilling/colonoscopy-assessment-platform
npm ci
npm run typecheck
npm test
npm run build
```

Do not start or restart production if any command fails. Start the verified
build with the checked-in PM2 configuration:

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs colonoscopy-assessment --lines 100
```

The PM2 configuration binds Next.js to `127.0.0.1:3000`. Configure PM2 to
restore the process after reboot:

```bash
pm2 startup systemd
```

Run the `sudo` command printed by `pm2 startup`, then save the process list:

```bash
pm2 save
```

## 5. Configure Nginx

Install the checked-in site configuration and disable the Ubuntu default site:

```bash
cd /var/www/deskilling/colonoscopy-assessment-platform
sudo cp deploy/nginx/colonoscopy-assessment.conf \
  /etc/nginx/sites-available/colonoscopy-assessment
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sfn /etc/nginx/sites-available/colonoscopy-assessment \
  /etc/nginx/sites-enabled/colonoscopy-assessment
sudo nginx -t
sudo systemctl reload nginx
```

Do not reload Nginx unless `sudo nginx -t` succeeds.

## 6. Health and Supabase smoke checks

Check Next.js directly, Nginx locally, and the public ECS address:

```bash
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code}\n' http://127.0.0.1:3000/
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code}\n' http://127.0.0.1/
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code}\n' http://<ECS_PUBLIC_IP>/
sudo ss -lntp | grep -E ':(80|3000)\b'
```

All HTTP requests should return `200`. The socket output must show Next.js on
`127.0.0.1:3000`, not `0.0.0.0:3000` or `[::]:3000`.

Then test the real Supabase path with a clearly labelled disposable development
participant ID. Only submit a response while the page reports DEV mode:

1. Open `http://<ECS_PUBLIC_IP>/` in a supported browser.
2. Confirm there is no Supabase configuration or fetch error.
3. Start Session 1 with an ID such as `DEPLOY_SMOKE_YYYYMMDD_HHMMSS`.
4. Confirm the persisted queue loads.
5. Confirm a private Supabase video receives a signed URL, loads, and seeks.
6. Submit one test response and confirm the assessment advances.
7. Record the disposable participant ID so its rows remain identifiable.

A homepage `200` does not verify the database, RPC, signed video, or response
submission path; complete both the HTTP checks and browser smoke test.

## 7. Manually update an existing deployment

Run this sequence only after an approved commit has already been promoted to
`origin/release`. The sequence does not fetch or deploy `main`.

First record the currently deployed commit and verify the checkout:

```bash
cd /var/www/deskilling
git rev-parse HEAD | tee "$HOME/deskilling-previous-release"
git status --short
git branch --show-current
```

Stop if the working tree is not clean or the branch is not `release`. Fetch and
fast-forward only the release branch:

```bash
git fetch origin release
git switch release
git pull --ff-only origin release
git rev-parse HEAD
```

Build and verify before touching the running PM2 process:

```bash
cd /var/www/deskilling/colonoscopy-assessment-platform
npm ci
npm run typecheck
npm test
npm run build
```

If any command fails, do not restart PM2; the existing process continues to run
the previous build. After all commands pass:

```bash
pm2 restart ecosystem.config.cjs --update-env
pm2 status
pm2 logs colonoscopy-assessment --lines 100
```

Repeat every HTTP and Supabase smoke check in Section 6. Record the new deployed
commit only after those checks pass.

## 8. Roll back to the previous known-good release

Read and validate the commit recorded immediately before deployment:

```bash
cd /var/www/deskilling
PREVIOUS_RELEASE="$(cat "$HOME/deskilling-previous-release")"
git show --no-patch --oneline "$PREVIOUS_RELEASE"
git fetch origin release
git merge-base --is-ancestor "$PREVIOUS_RELEASE" origin/release
```

If it is the intended known-good release commit, check out that exact revision
and rebuild it in the same working directory:

```bash
git switch --detach "$PREVIOUS_RELEASE"
cd /var/www/deskilling/colonoscopy-assessment-platform
npm ci
npm run build
pm2 restart ecosystem.config.cjs --update-env
pm2 status
```

Repeat all HTTP and Supabase smoke checks in Section 6. The production process
now runs the previous known-good revision. Do not move or force-push the remote
`release` branch as part of rollback.

After recovery, return the checkout to the release branch without pulling or
restarting it:

```bash
cd /var/www/deskilling
git switch release
```

PM2 continues serving the rollback build until a later approved manual release
is built and restarted.

## 9. Promote code before ECS deployment

Promotion happens on the development Mac, not on ECS. Use either the approved
fast-forward procedure or selective cherry-pick procedure in
[`environment-and-release-workflow.md`](environment-and-release-workflow.md).

Pushing `release` alone does not deploy anything. ECS changes only after the
manual update sequence in Section 7 is run.

## 10. Later domain and HTTPS setup

The current Nginx file intentionally uses `server_name _` and listens only on
port 80. When a domain is ready, update `server_name`, point DNS to the ECS
public IP, open port 443 in the security group, and configure an HTTPS
certificate. Keep port 3000 private during that change.
