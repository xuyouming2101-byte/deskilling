# Alibaba Cloud ECS Deployment

This guide deploys the current Next.js application to Ubuntu 22.04 on Alibaba
Cloud ECS. Supabase remains the database, RPC, Edge Function, and private video
Storage provider. The deployment does not use Alibaba Cloud RDS or OSS.

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
- Keep outbound HTTPS access available for package installation and operations.

## 1. Install Ubuntu packages

Log in with an Ubuntu user that has `sudo` access:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx
```

Install Node.js 22 LTS from NodeSource, then verify the installed runtime:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
node --version
npm --version
```

The Node.js version must be 22.x. Install PM2 globally and verify it:

```bash
sudo npm install -g pm2
pm2 --version
```

Confirm that Git and Nginx are available:

```bash
git --version
nginx -v
sudo systemctl enable --now nginx
```

## 2. Clone the repository

Use the real repository URL and deployment branch in place of the placeholders:

```bash
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
cd /var/www
git clone <REPOSITORY_URL> colonoscopy-assessment-platform
cd colonoscopy-assessment-platform
git switch <DEPLOYMENT_BRANCH>
```

Confirm the selected revision and require a clean working tree before building:

```bash
git rev-parse HEAD
git status --short
```

Do not deploy with uncommitted server-side changes.

## 3. Configure the production environment

Create an ignored production-local environment file from the checked-in
template:

```bash
cd /var/www/colonoscopy-assessment-platform
cp .env.production.example .env.production.local
chmod 600 .env.production.local
nano .env.production.local
```

Set exactly these variables using the current Supabase project values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Do not add `SUPABASE_SERVICE_ROLE_KEY` to the ECS Next.js environment. It is a
server secret used by the existing Supabase Edge Function and trusted upload
tooling, not by the deployed browser application. Never rename it to a
`NEXT_PUBLIC_...` variable.

Next.js embeds `NEXT_PUBLIC_...` values during `npm run build`. Rebuild the app
after changing either value. `.env.production.local` is already excluded by the
repository's `.gitignore` pattern for local environment files.

## 4. Install, verify, and build

Use `npm ci` so the server installs the exact dependency versions from
`package-lock.json`:

```bash
cd /var/www/colonoscopy-assessment-platform
npm ci
npm run typecheck
npm test
npm run build
```

Do not start or restart the production process if any command fails.

## 5. Start Next.js with PM2

The checked-in PM2 configuration runs one production Next.js process bound to
`127.0.0.1:3000`:

```bash
cd /var/www/colonoscopy-assessment-platform
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs colonoscopy-assessment --lines 100
```

Test the Next.js process directly from the ECS host:

```bash
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code}\n' http://127.0.0.1:3000/
```

The expected status is `200`. Configure PM2 to restore the process after an ECS
reboot:

```bash
pm2 startup systemd
```

Run the `sudo` command printed by `pm2 startup`, then save the current process
list:

```bash
pm2 save
```

## 6. Configure Nginx

Install the checked-in site configuration and disable the Ubuntu default site:

```bash
cd /var/www/colonoscopy-assessment-platform
sudo cp deploy/nginx/colonoscopy-assessment.conf \
  /etc/nginx/sites-available/colonoscopy-assessment
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sfn /etc/nginx/sites-available/colonoscopy-assessment \
  /etc/nginx/sites-enabled/colonoscopy-assessment
sudo nginx -t
sudo systemctl reload nginx
```

Do not reload Nginx unless `sudo nginx -t` succeeds. Verify both the local Nginx
route and the public ECS address:

```bash
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code}\n' http://127.0.0.1/
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code}\n' http://<ECS_PUBLIC_IP>/
```

Both requests should return `200`. Confirm that port 3000 is loopback-only:

```bash
sudo ss -lntp | grep -E ':(80|3000)\b'
```

The output must show Next.js on `127.0.0.1:3000`, not `0.0.0.0:3000` or
`[::]:3000`.

## 7. Application health checks

After the HTTP checks pass, use a clearly labelled development participant ID
to test the real browser workflow. Only perform response submission while the
page reports DEV mode:

1. Open `http://<ECS_PUBLIC_IP>/` in a supported browser.
2. Confirm the page loads without a Supabase configuration error.
3. Start a session with a disposable ID such as
   `DEPLOY_SMOKE_YYYYMMDD_HHMMSS` and Session 1.
4. Confirm the persisted queue loads and the current private Supabase video
   obtains a signed URL and plays.
5. Complete one video and confirm the response submission advances to the next
   queued video.
6. Record the disposable participant ID so its test rows remain identifiable.

This browser check verifies the current Supabase RPC, private Storage signed URL,
and response submission path. A homepage `200` alone does not verify them.

## 8. Update an existing deployment

Before updating, record the currently deployed commit:

```bash
cd /var/www/colonoscopy-assessment-platform
git rev-parse HEAD | tee "$HOME/colonoscopy-assessment.previous-release"
git status --short
```

Stop if the working tree is not clean. Then update and verify the selected
deployment branch:

```bash
git fetch --prune origin
git switch <DEPLOYMENT_BRANCH>
git pull --ff-only origin <DEPLOYMENT_BRANCH>
npm ci
npm run typecheck
npm test
npm run build
pm2 restart ecosystem.config.cjs --update-env
pm2 status
```

Run the direct and Nginx health checks again after every update.

## 9. Roll back

Read and validate the recorded previous revision:

```bash
cd /var/www/colonoscopy-assessment-platform
PREVIOUS_RELEASE="$(cat "$HOME/colonoscopy-assessment.previous-release")"
git show --no-patch --oneline "$PREVIOUS_RELEASE"
```

If it is the intended known-good commit, rebuild that exact revision and restart
PM2:

```bash
git switch --detach "$PREVIOUS_RELEASE"
npm ci
npm run typecheck
npm test
npm run build
pm2 restart ecosystem.config.cjs --update-env
pm2 status
```

Run both HTTP health checks and the browser video smoke test. To resume normal
updates later, switch back to the deployment branch before pulling:

```bash
git switch <DEPLOYMENT_BRANCH>
```

## 10. Later domain and HTTPS setup

The current Nginx file intentionally uses `server_name _` and listens only on
port 80. When a domain is ready, update `server_name`, point DNS to the ECS
public IP, open port 443 in the ECS security group, and configure an HTTPS
certificate. Do not expose port 3000 during that change.
