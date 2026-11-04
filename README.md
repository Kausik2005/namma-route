# Namma Route

Two versions of a Bengaluru route planner:

- `index.html`: offline version. It uses a built-in model of the main roads and typical traffic and needs no key.
- `live/index.html`: live version. It uses the Google Routes API (live and predicted traffic, alternative routes, best stop order) and the Maps JavaScript API (map with Google's live traffic layer).

## Run the live version

```bash
cd namma-route
python3 -m http.server 8000
```

Open http://localhost:8000/live/ and paste your API key. The key is stored only in your browser.

### Google Cloud setup
1. Create a project with billing turned on.
2. Enable **Routes API** and **Maps JavaScript API**.
3. Create an API key. Restrict it to those two APIs and to your site's address (for example `http://localhost:8000/*`).

Google bills per request. The page calls Google only when you press **Plan route** (1 request) or **Check departures** (7 requests).

### Use it on your phone
Host the folder on any static host, for example GitHub Pages, and add that address to the key's website restrictions.
