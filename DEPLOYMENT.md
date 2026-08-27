# Deployment, Migrations, and Rollback

Written as part of the deployment-maturity pass (2026-08-27) that also added
the CI workflow (`.github/workflows/ci.yml`) and the real backend/web lint
gates. This is the missing piece those items exposed: everything below about
Railway's and Vercel's actual build/start commands and rollback controls
lives only in each platform's own dashboard, invisible to anyone reading the
repo — this doc exists so that configuration survives a lost password, a new
teammate, or a service getting recreated from scratch.

## Architecture

- **Frontend** (`apps/web`, Next.js): deployed on **Vercel**, auto-deploys
  every push to `main`. Vercel builds *every* commit individually with no
  path filter (see Update 61) — a backend-only push still triggers (and
  should still succeed) a Vercel build.
- **Backend** (`apps/backend`, NestJS): deployed on **Railway**
  (`nurturing-celebration` project → `@ailm/backend` service), auto-deploys
  pushes to `main` that touch `apps/backend/**` (a Railway "Watch Path"
  filter — see Update 61's own note on Railway skipping frontend-only
  commits). Currently a single replica (`US West`).
- **Database**: Postgres, with the pgvector extension enabled (used for
  future semantic-memory work — see the project's own roadmap). Local dev
  uses the `docker-compose.yml` Postgres container; production uses a
  hosted Postgres (verified via Neon's own SQL Editor as far back as Update
  48's FK migration check).

## Migration strategy

**Verified directly against Railway's actual Settings (2026-08-27), not
assumed from the repo** — this was flagged 🟠 "verify/strengthen" and the
verification turned up a real, already-correct setup that just wasn't
documented anywhere:

- **Build Command:** `npm install && npm run prisma:generate --workspace=@ailm/backend && npm run build --workspace=@ailm/backend`
- **Start Command:** `npm run prisma:deploy --workspace=@ailm/backend && npm run start:prod --workspace=@ailm/backend`

`prisma:deploy` is `prisma migrate deploy` (see `apps/backend/package.json`)
— it runs automatically, applying any pending migration, immediately before
the server boots on **every** deploy. This is the right pattern (migrations
land before the new code that depends on them ever serves traffic) and was
already in place; the gap was that this configuration exists only in
Railway's dashboard, with nothing in the repo recording it. If this service
is ever recreated, or someone new needs to reconfigure it, the two commands
above are what to re-enter.

**Writing a safe migration.** Prisma's `migrate deploy` never prompts and
never drops data outside what the migration SQL itself does — so the actual
safety of a migration is about how the SQL is written, not the deploy
mechanism:
- Prefer additive migrations (new nullable column, new table) over
  destructive ones (dropping/renaming a column) whenever the old and new
  code need to coexist even briefly.
- A genuinely destructive migration (rename, drop, `NOT NULL` on an
  existing column) should ship as two migrations across two deploys: first
  add-and-backfill, then drop-the-old-column once the new one is confirmed
  populated — this is exactly the shape of the two-migration commit
  ordering already used for interdependent backend refactors this session
  (see Update 62's planner-modularization commit order for the same
  underlying discipline applied to code instead of schema).
- `apps/backend/prisma/migrations/` is the source of truth; never hand-edit
  a migration that has already been applied to production — add a new one
  instead.

## Rollback

### Backend (Railway)

Railway → `nurturing-celebration` → `@ailm/backend` → **Deployments** tab.
Every past deployment (including ones Railway has marked `REMOVED` after a
newer one superseded it) keeps a **⋮ → Rollback** action — confirmed
directly in the dashboard. This redeploys that exact prior build.

**The one thing rollback does NOT undo: a migration that already ran.**
`prisma migrate deploy` only ever moves forward — rolling the app back to a
previous deployment does not automatically revert a schema change the bad
deploy's own migration applied. Before rolling back a deploy that included a
migration:
- If the migration was purely additive (new nullable column/table), rolling
  back the app code is enough — the old code simply ignores the new column.
- If the migration was destructive (dropped/renamed something the old code
  reads), a code-only rollback will crash against the new schema — a
  hand-written down-migration (or restoring from backup, see below) is
  needed first.

This is exactly why the "prefer additive, two-step destructive" rule above
matters operationally, not just stylistically: it's what keeps a plain
app-level rollback sufficient in the common case.

### Frontend (Vercel)

Vercel → `ai-life-manager-web` → **Deployments** tab → open the prior good
deployment → **⋯ → Instant Rollback** (or **Promote** to make any specific
past build the new Production one) — both confirmed directly in the
dashboard. This re-points the production domain at that build immediately,
with no rebuild required.

### Coordinated frontend/backend releases

Flagged 🟡 in the scorecard, and it's a real property of this setup: Vercel
and Railway deploy independently on every push, with no shared release
train and no schema-compatibility check between them. The concrete risk is
a breaking GraphQL change landing on the backend before the frontend code
that relies on the *old* shape has stopped running (or vice versa) — this
is not hypothetical, it's the same root cause behind the transient Vercel
build failures Update 61 documented for two interdependent frontend files.

Until there's real infrastructure for this (a shared API-contract check,
feature flags, or a single coordinated release pipeline — none of which
exist today and are a bigger lift than this pass), the practical discipline
is:
1. Ship additive backend/schema changes (new fields, new queries/mutations)
   *before* the frontend code that consumes them — the old frontend simply
   ignores fields it doesn't know about yet.
2. Only remove/rename a GraphQL field or type once no deployed frontend
   build still queries the old shape.
3. For a genuinely breaking API change, land the frontend change and the
   backend change as close together as practical, and watch both
   dashboards (not just one) after pushing — the same "verify against the
   real dashboard, don't assume" discipline used throughout this project's
   deploy history (see Update 51's CORS outage for what skipping this step
   costs).

## Database restore testing

Flagged 🔴 "before real users" — correctly. As of this pass, there is no
documented or tested restore procedure anywhere in this repo, and none was
exercised here either: restoring a database (even to a branch, not
production) touches real production data and real provider-specific
mechanics (Neon's point-in-time-recovery window depends on the plan tier),
which isn't something to execute unverified inside an automated pass.

**What this needs, concretely, before real users are on this app:**
1. Confirm what backup/PITR capability the current Postgres plan actually
   includes (this depends on the specific Neon plan and hasn't been
   checked) — a plan can have zero retention window by default.
2. If PITR is available, actually perform a restore-to-a-point-in-time into
   a *new, throwaway* database/branch — never test a restore against the
   live database — and verify the restored data looks right.
3. Time how long that restore actually takes, so there's a real answer to
   "how long would we be down" rather than a guess.
4. Write down the exact steps (which dashboard, which button, what to
   expect) here, the same way the rollback steps above are now written
   down from having actually clicked through them.

This is intentionally left as a next action rather than attempted here —
see the project's `claude/project-state.md` for tracking.
