# Give with intention

A small static page. You enter what you pay for AI, pick a pledge percentage, and see nature volunteer roles near you (Toronto and the GTA to start).

It has no backend, no accounts, no cookies, no analytics and no storage. Location and numbers stay in the browser tab.

## What it is (and isn't)

- **It is** a prompt to give back. The pledge is a percentage the user chooses of what they actually pay.
- **It isn't** an emissions calculator or an offset. The page says so, next to the pledge.
- The volunteer list is **hand-picked**, not a live feed. Each entry records what we confirmed on the organization's own page, what we couldn't, and the date we checked.

## Run it locally

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

Opening `index.html` by double-click won't load the data files because browsers block `fetch` on `file://`. The page shows a message explaining this.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. Settings → Pages → Build and deployment → Deploy from a branch → `main` / root.

## Link checker

`scripts/check-links.mjs` visits every link in `data/` and writes `data/link-status.json`. The workflow in `.github/workflows/link-check.yml` runs it every Monday and commits the result.

- A link that loads is `ok`.
- A link that fails once keeps its old status (or is `unverified` if it was never `ok`).
- A link that fails twice in a row is `unverified`.
- Links are never hidden. The page shows an "Unverified" marker.

The check only proves a page **loads**. It can't tell whether the content is still correct, so re-read an entry's page when you update it.

Run it by hand: `node scripts/check-links.mjs`. Run the tests: `node --test tests/check-links.test.mjs`.

GitHub can pause scheduled workflows on repos with no recent activity. If the "Links last checked" date at the bottom of the page gets old, check the Actions tab.

## Add a place

Edit `data/opportunities.json`. For each entry:

1. Open the organization's own volunteer page and read it.
2. Fill in only what the page says. Put anything the page doesn't say under `notConfirmed`.
3. Set `checked` to today's date (`YYYY-MM-DD`).
4. Give it an `anchor` (a label plus latitude and longitude of the city centre or venue), or `null` if it has no fixed place.
5. Keep `url` on `https`. The tests fail if it isn't.

Add a city to the `CITIES` list in `index.html` so people can pick it.

## Known gaps

- No verified volunteer page yet for Conservation Halton (Burlington, Oakville, Milton) or Central Lake Ontario Conservation (Whitby, Oshawa). Add them once you've read their pages.
- Toronto Wildlife Centre's page doesn't state where roles are or whether it's accepting volunteers.
- Credit Valley Conservation recruits in February and March, so its page may show closed.
- Donation links were found by web search. The link checker only confirms they load.
