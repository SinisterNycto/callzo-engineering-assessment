# Task 2: Usage Admin Console

This is an admin console for browsing account usage and editing an account's 4-step settings form, built on the provided mock API.

Stack: React 19, Tailwind 4, Recharts. Those are the only runtime libraries (Recharts needs `react-is` as a peer dependency). Vite is used only to build the app. Routing, data fetching, polling and form state are about 400 lines of hooks in `src/hooks/`, instead of React Router or React Query.

## Running it

```bash
docker compose up
```

Then open http://localhost:3000. The mock API is also exposed at http://localhost:8001.

The `frontend` service uses a pre-built image from Docker Hub, as the spec requires. Nothing is built from source when you run `docker compose up`. Inside the container, nginx serves the static build and proxies `/api/*` to `http://mock-api:8001` over the Docker network:

- The browser only ever talks to `localhost:3000/api/...`.
- There's no CORS setup.
- The browser never needs the `mock-api` hostname, which only resolves inside Docker.
- The proxy target comes from the `API_URL` environment variable in the compose file.

### Publishing the image

This is how the image referenced in `docker-compose.yml` is produced. Build it for both architectures so it runs on Intel and Apple Silicon:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t swastiknegi/callzo-task2-frontend:1.0.0 --push .
```

### Local development

```bash
docker compose up mock-api      # the mock API on :8001
npm ci
npm run dev                     # http://localhost:3000, Vite proxies /api to :8001
npm test                        # 35 unit tests, Node's built-in test runner (no test library)
```

## What the mock API actually does

I probed every endpoint before building, because some of the behaviour isn't in the spec and the UI depends on it:

- `/accounts/summary` failed about 25% of the time in my runs. It returns the current-month usage of accounts, grouped by their signup date, one point per day. With no date range that's 1,036 points.
- The list endpoint returns an empty page if `page` is past the end; it doesn't return an error. It silently ignores a malformed `date_from`.
- `null` for the optional step-3 caps is rejected with "must be a number". Blank caps have to be left out of the request.
- **The step-2 trap.** Once step 4 has ever been saved, every step-2 save fails with `billing_country is required`, even with a valid value. The step-2 data saved earlier stays on the server, and submit still succeeds with it. If step 4 gets saved before step 2 was ever saved, the account can never be completed, because step 2 can then never be saved. There's no endpoint to delete a step.

## Assumptions

- **What "account usage" means for the chart.** The date range filters on `signup_date`, because that's the only date the API can filter on. The chart is therefore labelled "Usage by signup date": it shows the usage of accounts that signed up on each day. I didn't label it "usage over time", because it isn't that.
- **What "editing account usage" covers.** The only write endpoints are the settings form, so that's what editing means here. Selecting rows leads to a CSV export of the selected accounts, which gives selection a real purpose without inventing a bulk-edit API.
- **How "failed saves must roll back cleanly" applies to an autosaving form.** I read it as: the UI never shows something as saved unless the server confirmed it, and a failed save leaves no half-applied state. I don't throw away what the user typed. Details are under "The settings form" below.

## Where state lives

| state | where | why |
|---|---|---|
| Search, filters, sort, page, page size, date range | **URL** query string (`?q=…&plan=pro&sort=cost_cents&dir=desc&page=3`) | Shareable and bookmarkable, and Back/Forward undo filter changes. Reload keeps your place. Values are validated on read, so a hand-edited URL can't send junk to the API. |
| Settings step you're on | **URL** (`/accounts/42/settings?step=2`) | Reload returns you to the same step, and Back moves between steps. A deep link to a step you can't reach yet is corrected to the furthest reachable step. |
| Accounts page, summary, account record | **Server**, held in hooks as a cache (`usePolledQuery`) | The server owns this data and it changes on its own (the list drifts on every call), so the client never edits it, only re-fetches it. |
| Settings drafts | **Server** is the draft store. Steps autosave via `PUT .../step/N` and are restored via `GET .../settings`. | Closing the tab or switching devices doesn't lose a saved step. |
| What's in the inputs right now, and what the server last confirmed | **Client** (`useSettingsForm`): `drafts` vs `saved` | Keeping the two apart is what makes rollback exact (see below). |
| Row selection | **Client**: a `Map<id, row>` lifted to `App` | Selection can be thousands of ids, too many for a URL. Keying by id is what keeps it stable across pages, sorting and refreshes. It sits above the router, so it survives a trip into an account's settings and back. It doesn't survive a reload, and I'm fine with that. |
| Live-updates toggle, chart metric | **Client**, component state | Pure view preferences. |

## How the requirements are met

**Table: server-side search, sort, filters, pagination.**
- Search is debounced by 350 ms (Enter applies it immediately).
- There are filters for status, plan and country, plus the date range.
- Sorting is on every column, using `aria-sort` and real buttons.
- Any change other than paging resets to page 1. If drift or a filter leaves you past the last page, you're moved to the last real page.

**Stable selection.** Selection is keyed by account id, and each selected row's latest copy is kept for the export. The header checkbox selects or deselects the current page and shows an indeterminate state for a partial selection. The bar shows "N selected · M on this page".

**Date range.** There are presets (all time, last 30/90 days, this year, last year) and a custom from/to. An inverted range shows an error and isn't applied. A change updates the URL, which re-fetches both the table and the chart. There's no full page reload, because the router is just `history.pushState`.

**Periodic refresh without jumping.** The table polls every 20 s and the chart every 60 s, and both pause while the tab is hidden. A background poll never shows a loading state:
- If the poll returns the same rows, the on-screen order is kept and only the values are swapped. The cells that changed flash briefly, numbers use tabular figures so widths don't shift, and row heights are fixed.
- If the set of rows changed (for example, when sorted by cost and drift moves a row onto a different page), the table is left alone. A bar says "Rows on this page have changed" with a **Show latest** button. Nothing moves under your cursor unless you ask for it.
- Selection is unaffected either way, because it's keyed by id.
- There's a toggle to turn live updates off.

**The randomly failing endpoint.** Summary requests retry automatically on 5xx or network errors, twice, with backoff (0.4 s, then 1.2 s). That turns a 1-in-4 failure rate into roughly 1 in 64. If all three attempts fail:
- the chart shows an inline error with **Try again**;
- the stat tiles show "—";
- the table carries on normally.

If a background poll fails, the last good chart stays, with "Couldn't refresh. Showing data from 14:02:11 · Retry now".

### The settings form

- **Four steps, in order.** "Save and continue" validates the step locally, saves it, and only then moves on. The stepper lets you go back to any earlier step, or forward to any step that's already saved. Saving strictly in order means step 4 can never exist without step 2, which avoids the trap that would leave an account permanently stuck.
- **Autosave.** Each step saves itself 800 ms after you stop typing, as long as it passes local validation. A status line reports "Saving…", "Saved at 14:02:11", "Unsaved changes" or "Not saved". If you leave the page in-app, pending saves are flushed rather than dropped. Closing the tab with unsaved work triggers the browser's leave-page warning.
- **Drafts are restored.** On load, saved steps come from `GET /settings`. Steps with nothing saved are prefilled from the account record (name, email, plan, and country if it's one we can bill in).
- **Server errors land on the step they belong to.** A 422 response carries `detail.step`, and that is what decides where the error goes, not the step you happen to be on. The error shows next to the field (linked with `aria-describedby`), in a panel at the top of that step, as a "!" marker on that step in the stepper, and as a "rejected change" tag in the sidebar. If you're on step 4 while step 2 has a rejected change, step 4 shows "Step 2 has a change the server rejected → Go to step 2".
- **Submit re-saves any changed step first.** If a save fails, you're taken to the failing step with focus on its error panel. A `400 missing_steps` response takes you to the first missing step.
- **Rollback.** The UI keeps two copies of each step: `saved` (what the server confirmed) and `drafts` (what's in the inputs).
  - A failed save never touches `saved`, so the stepper, the "Saved on the server" sidebar and the step's status all stay exactly as they were. That's the rollback, and it's exact by construction.
  - The user's input isn't wiped. The error panel says what's still on file ("Still on file for this step: Pro · United States") and offers **Undo my changes**, which resets the inputs to the saved values and clears the error, or **Try saving again**.

**How the step-2 trap plays out.** I deliberately didn't special-case it. The form handles any server-side step error the same generic way, and this is one instance:

1. You fill in all four steps, go back to step 2, and change the country.
2. The autosave gets a 422.
3. Step 2 shows the error, says "Still on file: Pro · United States. Nothing else in the form was affected", and offers Undo.
4. If you go to step 4 and press Submit anyway, submit re-saves step 2, gets the 422 again, and takes you back to step 2 with focus on the error panel.
5. Press Undo, and submit goes through with the saved value. You're never stuck, and nothing you saved on other steps is lost.

I didn't pre-emptively lock the country field once step 4 exists. That would hard-code a quirk of this mock into the UI, and the generic handling already explains what's going on.

**Loading, empty, error and partial-failure states:**

| view | loading | empty | error | partial failure |
|---|---|---|---|---|
| Accounts table | skeleton rows; when refetching, the old rows are dimmed with a progress bar | "No accounts match" + Clear filters | error + Try again | poll fails → keep data, banner with time + Retry |
| Chart + tiles | skeleton | "No usage in this range" | inline error + Try again (after 3 attempts) | poll fails → keep chart, "couldn't refresh" note |
| Settings page | skeleton | n/a | settings fail to load → blocking error + Try again (editing without knowing the saved draft could overwrite it); 404 → "Account not found" | account lookup fails but settings load → form works, header shows "Couldn't load this account's details" + Retry, which doesn't reset your inputs |
| API status (sidebar) | "Checking API…" | n/a | "Mock API unreachable" | n/a |

**Keyboard and screen readers.**
- Everything is a native control: real buttons, links, checkboxes, radios and selects. The table is a real `<table>` with a caption describing the current sort and page.
- There's a skip link.
- Focus moves on purpose:
  - to the page `<h1>` on route change;
  - to the step heading on step change;
  - to the first invalid field when local validation fails;
  - to the error panel when the server rejects a save;
  - to "Settings submitted" on success.
  - The mobile menu closes on Escape and returns focus to its button.
- The save status and selection count are announced in live regions.
- Every error is tied to its input with `aria-describedby` and `aria-invalid`.
- The space for a field's error is always reserved, so an error appearing on blur can't shift the layout and make the next click miss its button. Testing caught exactly that bug.

**375 px.**
- The sidebar becomes a top bar with a menu button.
- The table drops to checkbox, account (company shown under the name), cost and Edit.
- Tiles go two-up, filters wrap, and the stepper turns into four compact buttons.
- I checked for horizontal overflow at 375 px on both pages with a scripted browser, and there is none.

## What I cut, and why

- **A table library and virtualised rows.** Pages are at most 100 rows, so a plain table is faster to read, and the brief limits libraries anyway.
- **Keeping selection across reloads.** I'd put it in `sessionStorage`, but I wasn't sure an admin would want a stale selection to come back. Easy to add.
- **Bulk actions beyond CSV export.** The API has no bulk write endpoints, and I didn't want to fake one.
- **A local backup of unsaved form edits.** The server is the draft store. If a save fails and you close the tab, the unsaved edit is lost; the browser's leave-page warning covers that case. A `localStorage` mirror would cover it fully, but it adds a third copy of the form to keep in sync.
- **An "unsaved changes" warning on in-app navigation.** Valid edits are flushed on the way out. Invalid edits (for example a half-typed email) are dropped.
- **A data-table view of the chart for screen readers.** The chart has an `aria-label` summary (range, metric, peak), but not the full series as a table. That would be the next accessibility addition.
- **Component tests.** The 35 tests cover the logic that's easy to get wrong: URL parsing, merging a refresh, retry rules, form validation and payloads, routing a server error to its step, chart bucketing, and CSV escaping. I tested the React behaviour by driving the real Docker build in headless Chrome (sorting, paging with selection, a live poll, the whole step-2 trap flow, forced endpoint failures, 375 px). I didn't commit that script, because Playwright would be a fourth library.
- **Code-splitting.** The bundle is about 190 KB gzipped, mostly Recharts. That's fine for an internal tool.

## Trade-offs

- **Hand-written router and polling hooks instead of libraries.** They're short and do only what this app needs. The cost is that I own edge cases a library has already solved: there's no request deduplication across components, and no shared cache between the overview and settings pages.
- **Keeping on-screen order during refresh.** Rows can be slightly out of sort order until you interact or press "Show latest". I preferred that to rows jumping under the cursor.
- **Autosave without locking the form.** You can keep typing while a save is in flight. A newer save overrides an older one, and a stale response is ignored.

## Layout

```
src/
  App.jsx                    routes + selection state
  pages/OverviewPage.jsx     header, tiles, chart, accounts card
  pages/SettingsPage.jsx     4-step form: focus, submit, error routing
  hooks/usePolledQuery.js    fetch + background poll (shared by table and chart)
  hooks/useAccounts.js       table-specific merge-on-poll
  hooks/useSummary.js        summary with retry
  hooks/useSettingsForm.js   drafts vs saved, autosave, rollback, submit
  hooks/useSelection.js
  hooks/useLocation.js       ~30-line router
  lib/                       pure logic (query/URL, refresh merge, retry, form rules, series, csv, formatting)
  components/                table, chart, tiles, date range, stepper, fields, ui primitives
tests/                       node:test unit tests for lib/
nginx/default.conf.template  static serving + /api proxy
```
