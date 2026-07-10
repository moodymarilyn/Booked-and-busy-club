# Book Club Picker

Private site for ~8 members to recommend books, vote anonymously, and pick the next read with a weighted lottery. Plain HTML/CSS/JS on GitHub Pages + Supabase (free tier).

## Files

- `index.html` — login, current read, lottery, add-recommendation search, pool leaderboard
- `archive.html` — books the club has finished
- `js/config.js` — **edit this** with your Supabase URL + anon key
- `js/app.js`, `css/style.css` — app logic and styles
- `supabase-setup.sql` — run once in Supabase to create everything

## Setup (~15 minutes)

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste and run `supabase-setup.sql`. First edit section 6 at the bottom to list your club's ~8 emails.
3. In **Authentication → Sign In / Up**, make sure **Email** provider is enabled with magic links (OTP) — this is the default. Passwords are never used.
4. In **Settings → API**, copy the **Project URL** and **anon public key** into `js/config.js`.

### 2. GitHub Pages

1. Create a repo and push these files (config.js included — the anon key is safe to publish; all security is RLS).
2. Repo **Settings → Pages** → deploy from the `main` branch, root folder.
3. Take your Pages URL (e.g. `https://you.github.io/book-club/`) and add it in Supabase under **Authentication → URL Configuration**: set it as the **Site URL** and add it to **Redirect URLs**. Magic links won't redirect properly without this.

### 3. Smoke-test the RLS (the one security task that matters)

Log in with an email **not** on the allowlist. You should see the "members only" screen, and even from the browser console every table read/write should return zero rows or an error. Then log in with a member email and confirm everything works. Also verify that `select added_by from books` fails — that column is never exposed.

## How anonymity works

The DB stores who recommended/voted/read what (needed for one-vote-per-person and read counts), but the UI never shows names, and clients **cannot query** other members' vote rows or the `added_by` column — tallies come from an aggregate-only view. Known caveat: the project admin can see raw rows in the dashboard.

## Known quirks

- **Free-tier pausing:** Supabase pauses projects after ~1 week of inactivity. Un-pause from the dashboard when it happens, or set up a weekly keep-alive (e.g. a GitHub Action that curls `{SUPABASE_URL}/rest/v1/` with the anon key on a cron schedule).
- **Book search** uses the Google Books API. Keyless access shares a public quota that's often exhausted, so get your own free key: [console.cloud.google.com](https://console.cloud.google.com) → create a project → enable **Books API** → Credentials → **Create API key** → under "Application restrictions" pick **Websites** and add `https://moodymarilyn.github.io/*` → paste the key into `js/config.js` (`GOOGLE_BOOKS_API_KEY`). That gives 1,000 searches/day. The referrer restriction makes the key safe to publish.
- Each Google Books edition is a separate volume, so the same book can occasionally appear more than once in results — pick the edition you want.
- **Race conditions** (two people accepting a lottery pick at once) are handled by the database — one wins, the other gets a friendly error.

## v2 parking lot

Post-read star ratings, stats page, personal suggestions, comments, Goodreads import, admin roles — all deliberately out of scope.
