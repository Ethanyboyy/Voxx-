# Deploying VOX (Fly.io)

This is the exact, minimal runbook to get VOX always-on in the cloud. Everything in
this repo (`Dockerfile`, `docker-entrypoint.sh`, `fly.toml`, `/api/health`) is already
written and tested locally — this file is only the handful of steps that require your
own Fly.io account and can't be run from inside an AI coding sandbox (no account
credentials, and this environment's network policy blocks fly.io's domains outright).

You do **not** need Docker installed locally — `fly deploy` builds the image on Fly's
own remote builder by default.

## 1. One-time account setup

```bash
curl -L https://fly.io/install.sh | sh     # installs flyctl
fly auth signup                            # or `fly auth login` if you already have an account
```

## 2. Create the app and volume

From the repo root:

```bash
fly launch --no-deploy --copy-config
```

`--copy-config` tells it to use the `fly.toml` already committed here instead of
generating a new one. If it still offers to overwrite `fly.toml`, say no — the
committed version has the volume mount, always-on, and health-check settings this
deployment depends on. Change the `app` name in `fly.toml` first if `vox-personal` is
already taken (Fly app names are globally unique).

Create the persistent volume the SQLite database lives on (must be in the same region
as `primary_region` in `fly.toml`):

```bash
fly volumes create vox_data --region iad --size 1
```

(1GB is generous for a single-user SQLite database; resize later with `fly volumes extend` if ever needed.)

## 3. Set secrets

Never put these in `fly.toml` — they go in Fly's encrypted secret store, injected as
env vars at runtime, never baked into the image:

```bash
fly secrets set VOX_ENCRYPTION_KEY="$(openssl rand -base64 32)"
fly secrets set VOX_SESSION_SECRET="$(openssl rand -base64 32)"

# Optional — omit to run on the deterministic mock AI provider (no key needed,
# fully usable). Set this only if you want real Claude responses:
fly secrets set ANTHROPIC_API_KEY="sk-ant-..."
```

Do **not** set any of the Connections Hub vendor env vars (`GOOGLE_OAUTH_CLIENT_ID`,
`PLAID_CLIENT_ID`, etc.) — leaving them unset is what keeps every connection a stub
per the security boundary in `SECURITY.md`.

## 4. Deploy

```bash
fly deploy
```

This builds the image remotely, runs `docker-entrypoint.sh` on boot (applies Prisma
migrations against the volume, then starts `next start`), and Fly's health check hits
`/api/health` before routing traffic to the new instance.

## 5. Create your account

Visit `https://<your-app-name>.fly.dev` — you'll land on `/setup`. Create your account
there. This is the only time `/setup` will ever succeed (see `SECURITY.md` — enforced
at the database transaction level, not just the UI).

## 6. Verify

- `curl -I https://<your-app-name>.fly.dev/api/health` → `200`
- Load the site fresh (private/incognito tab) → redirects to `/login`, not straight
  into the app.
- `fly logs` to watch the entrypoint's migration step succeed on first boot.
- `fly machine restart <machine-id>` (from `fly status`) → confirm the app comes back
  and your account/data are still there (proves the volume persists across restarts,
  not just across code deploys).

## Ongoing

- `fly deploy` again any time you push new code — it rebuilds and replaces the running
  machine with zero manual steps beyond that one command.
- `fly logs` / `fly status` for health.
- Fly volumes are automatically snapshotted daily (a few days of retention) — a basic
  backup story with nothing extra to configure.

## Custom domain / a second auth layer later (optional, not required)

Fly gives you `https://<app-name>.fly.dev` with a valid cert out of the box — nothing
below is required to be secure or usable. If later you want a memorable domain, or a
second login gate in front of VOX's own (e.g. Cloudflare Access) rather than relying on
`fly.dev` + VOX's own auth alone, that's a separate, purely additive step — ask and
we'll walk through it then rather than doing it speculatively now.
