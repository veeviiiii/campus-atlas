# Uploads on the site (Supabase)

The website stays a static site that reads its papers from `packs/`. One page, `/upload/`, talks to
Supabase from the browser: sign in with Google, send the pages of a paper, see what became of it.
The maintainer's laptop fetches what was sent (`python -m pipeline.fetch_uploads`) and the intake desk
is the review queue. Until the two website variables below are set, `/upload/` points to the Google
Form and nothing else on the site changes.

The rules are tried on a real project: `npm run test:access` passed all 17 tests on the test project on
24 November 2026. The fetch script has not yet fetched a real upload.

## One-time setup

1. **Two free projects** at supabase.com (region: Mumbai): `campus-atlas` (live) and
   `campus-atlas-test` (for the access tests; the free plan allows two).
2. **The database rules.** In each project: SQL Editor, paste
   [migrations/0001_uploads.sql](migrations/0001_uploads.sql), Run; then the same with
   [migrations/0002_keep_alive.sql](migrations/0002_keep_alive.sql).
3. **Sign-in, live project.** Authentication > Providers: turn **Google** on with a Google Cloud OAuth
   client (Google Cloud console > APIs & Services > Credentials > OAuth client ID, type "Web
   application", with the redirect URI Supabase shows on that screen), and turn **Email** off.
   Authentication > URL Configuration: Site URL `https://campus-atlas.vercel.app`, and under Redirect
   URLs `https://campus-atlas.vercel.app/upload/` and `http://localhost:3000/upload/`.
4. **Sign-in, test project.** Leave **Email** on (the tests make throwaway accounts with passwords).
5. **Run the access tests** against the test project. Its keys are in Settings > API Keys: the
   publishable key (`sb_publishable_…`) and a secret key (`sb_secret_…`, called the service key here;
   older projects have `anon` and `service_role` instead). In `web/.env.test.local` (never committed):
   ```
   SUPABASE_TEST_URL=https://<test project>.supabase.co
   SUPABASE_TEST_ANON_KEY=<its publishable key>
   SUPABASE_TEST_SERVICE_KEY=<its secret key>
   ```
   then, in `web/`:
   ```bash
   npm run test:access
   ```
   Every test must pass before the live project gets its first real upload. They try what a
   signed-out visitor, another student and a banned account must not be able to do.
6. **The website.** In `web/.env.local` and in the Vercel project (Settings > Environment Variables),
   from the live project's Settings > API Keys:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<live project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<its publishable key>
   ```
   These two are public by design. Redeploy; `/send/` now leads to `/upload/`.
7. **The laptop.** In the repository's `.env`: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (the live
   project's **secret** key, `sb_secret_…`). That key skips every rule: it never goes into `web/` or
   Vercel.
8. **Keep it awake.** GitHub > the repo > Settings > Secrets and variables > Actions, two repository
   secrets from the live project: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the same publishable key as
   step 6; never the service key). `.github/workflows/keep-supabase-awake.yml` then calls
   `keep_alive()` every morning (06:15 IST), so the free project is never paused for inactivity. To
   try it now: Actions > keep-supabase-awake > Run workflow.

## Day to day

```bash
.venv/Scripts/python -m pipeline.fetch_uploads fetch      # what is waiting -> data/inbox/uploads-<date>/
.venv/Scripts/python -m pipeline.desk "data/inbox/uploads-<date>"
.venv/Scripts/python -m pipeline.fetch_uploads mark <id> published --pack davv-sdsf/mtech-aids-dual-sem1
.venv/Scripts/python -m pipeline.fetch_uploads mark <id> rejected --why "an answer sheet, not a question paper"
.venv/Scripts/python -m pipeline.fetch_uploads mark <id> held --ask "Which year was this End Sem held?"
.venv/Scripts/python -m pipeline.fetch_uploads tidy       # now and then: delete photos nobody will look at again
```

The rest is [ADDING-PAPERS.md](../ADDING-PAPERS.md), unchanged.

## What the rules allow

- A signed-out visitor: nothing, except `keep_alive()`, which only rewrites one timestamp nobody can read.
- A signed-in student: add an upload (only the form's fields; 5 waiting and 10 a day at most), read
  their own uploads, put up to 12 photos or PDFs of 10 MB into an upload of theirs that is still
  waiting, take a waiting upload back, answer a question the maintainer asked about it.
- Nobody but the service key: read other people's uploads or photos, change a status, read the ban list.
- To ban an account: add its user id to `banned_users` in the Table Editor.

## Free plan

50,000 monthly users, 500 MB database, 1 GB of files, 5 GB of downloads a month, files of 50 MB at
most (checked on supabase.com/pricing, 15 Nov 2026). Uploaded photos are deleted once a paper is
published or rejected, so they stay far below 1 GB. A free project is paused after a week with too
little database activity; the daily `keep_alive()` (step 8) prevents that. If it is paused anyway,
the papers on the site are not affected: only `/upload/` stops working until the project is restored
from the dashboard (its data is kept). GitHub turns scheduled workflows off in a public repository
after 60 days without any commit; if that happens, turn keep-supabase-awake back on in the Actions tab.
