# Running VOX from an iPhone

Two separate questions, and they have different answers.

## 1. Operating VOX from your phone — solved, once it is deployed

VOX is already phone-first: the app shell, chat, the Brain and the Lab are all
verified at a 390px viewport with no horizontal overflow, touch orbit and pinch
zoom on the 3D surfaces, and a bottom nav instead of hover-dependent controls.
Nothing extra is needed to *use* it from Safari once it is running somewhere.

Add it to your home screen (Share → Add to Home Screen) and it opens
chrome-free, like an app.

## 2. Deploying it from your phone — possible, with one honest constraint

VOX stores its data in **SQLite on a file** (`DATABASE_URL=file:/data/prod.db`).
That means the host must give the container a **persistent disk**. Platforms
whose free tiers have ephemeral filesystems will appear to work and then lose
every conversation, memory and run on the next restart. That is the whole
constraint; everything else about this repo deploys cleanly, because the
`Dockerfile` is self-contained and standard (`EXPOSE 3000`, entrypoint runs
migrations then `next start`).

### Option A — Render, entirely from Safari (no terminal)

Render's dashboard works on a phone and builds the `Dockerfile` straight from
GitHub.

1. <https://render.com> → sign in with GitHub → authorise the `Voxx-` repo.
2. **New → Web Service**, pick the repo and the branch you want live.
3. Render detects `Dockerfile` on its own. Leave build/start commands empty.
4. **Add a Disk**: mount path `/data`, 1 GB is plenty. This is the step that
   matters — without it the database is wiped on every deploy. Disks require a
   paid instance type; the free tier has no persistent storage.
5. Environment variables:
   - `DATABASE_URL` = `file:/data/prod.db`
   - `NODE_ENV` = `production`
   - `ANTHROPIC_API_KEY` — optional. Without it VOX runs on its mock provider
     and says so honestly rather than pretending to think.
6. Deploy. First build takes a few minutes. You get an `https://….onrender.com`
   URL — open it in Safari and add it to your home screen.

Every later deploy is a `git push`, which you can do from GitHub's mobile web
editor or the GitHub iOS app.

### Option B — Fly.io, one laptop session then phone-only forever

`fly.toml` in this repo is already written for this app (volume mount at
`/data`, always-on, health check). It needs `flyctl`, which needs a terminal
once:

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
fly launch --no-deploy   # decline regenerating fly.toml — keep the committed one
fly volumes create vox_data --size 1
fly deploy
```

The app name in `fly.toml` must be globally unique on Fly; change it if taken.
After that first deploy, `fly deploy` can be triggered from GitHub Actions on
push, so you never need the terminal again. Full runbook: `DEPLOYMENT.md`.

### Which to pick

Render if you want to never touch a terminal. Fly if you have five minutes at a
computer once and prefer its always-on volume pricing.

## What cannot be deployed from inside an AI coding session

Both paths need *your* account credentials, and this sandbox's network policy
blocks fly.io outright. An agent working in this repo can prepare, verify and
commit everything — it cannot create the account, hold the billing details, or
reach the host. The deploy step is yours by necessity, not by oversight.
