# Namma Route

A Bengaluru commute planner that answers three questions: which road, which hour, and whether the metro would be quicker.

| Page | Data | Needs |
| --- | --- | --- |
| `index.html` | ~420 searchable places (localities, landmarks, metro stations) on a built-in model of ~110 junctions (Nelamangala to Hoskote, Bidadi to Attibele), the arterial roads and NICE Road, and the Purple, Green and Yellow metro lines (Pink and Blue optional), with a typical-day traffic model. Can use OpenStreetMap roads and stations instead (see below) | Nothing; works offline |
| `live/index.html` | Google Routes API (live and predicted traffic, transit) and Maps JavaScript API (live traffic layer) | Your Google Maps API key |

## Features
- **Fastest route** that accounts for when you leave: morning traffic toward the tech corridors and evening traffic away from them, lighter weekends, and known bottlenecks like Silk Board, Tin Factory and Hebbal.
- **Lines being built:** an optional switch adds the Pink Line (Kalena Agrahara–Nagawara) and Blue Line (Silk Board–KR Puram–Airport) to see how they would change your trip.
- **Namma Metro vs road:** door-to-door metro trips, including the walk or auto to and from the station, line changes at Majestic and RV Road, and the wait for the next train, compared with driving.
- **When should you leave?** Trip time for every 15-minute departure, with the metro alternative drawn on top.
- **Your week on this trip:** a grid of every day and half hour, to pick office days and hours.
- **Where you lose time:** the stretches that cost you the most (offline), or the slow and jammed stretches Google reports, named after the nearest landmark (live).
- **Arrive by:** set when you need to be there and get the latest departure by road and by metro.
- **Trip cost:** fuel and tolls for driving, metro fare plus auto fare for the metro option.
- **Saved commute:** one tap for the trip to work and the trip back home.
- **Your places:** save home, work or anywhere else by tapping the map, long-pressing it, or pasting coordinates or a Google Maps link. They are kept only in your browser, show on the map, and can be typed in any box. A place called "Home" becomes the default start.
- **Multiple stops:** up to 6 stops (offline) or 8 (live), put in the fastest order. Also car or two-wheeler, avoid tolls, rain mode, and handoff to Google Maps.

## Use OpenStreetMap roads and metro (optional)
`tools/import-osm.mjs` downloads Bengaluru's roads and Namma Metro from OpenStreetMap through the [Overpass API](https://overpass-api.de) and writes `data/osm-bengaluru.js`. When that file is present, `index.html` plans on the real road network instead of the built-in one. Without it, nothing changes.

```bash
node tools/import-osm.mjs
```

Needs Node 18 or later and no packages. The download can take a few minutes and is saved in `.osm-cache/`, so `node tools/import-osm.mjs --from-cache` rebuilds without downloading again. If overpass-api.de is unreachable, run `node tools/import-osm.mjs --print-queries`, run the two queries on [overpass-turbo.eu](https://overpass-turbo.eu) or another Overpass server, export the raw JSON, and build from the files:

```bash
node tools/import-osm.mjs --roads roads.json --metro metro.json
```

Other options: `--endpoint URL` for another Overpass server, `--bbox south,west,north,east` (default `12.70,77.30,13.26,77.86`), `--no-tertiary` to leave out tertiary roads, `--no-secondary` for a smaller network with only motorway, trunk and primary roads, and `--out PATH`. Behind an HTTPS proxy, run with `NODE_USE_ENV_PROXY=1` (Node 22.21 or later).

What the importer keeps:
- **Roads:** motorway, trunk, primary, secondary and tertiary roads and their ramps, with real lengths and shapes, one-way streets and `toll=yes`. Junctions less than 70 m apart along a road (dual carriageways, slip roads, roundabouts) become one junction, stretches that just continue the same road are joined, and only the part of the network where every junction can reach every other one is kept.
- **Metro:** every `route=subway` (or light rail) relation, with stations in running order from its stops, named and placed after the nearest station node. Each line keeps the direction with the most stations.

How the planner uses it:
- Each OSM road takes its bottleneck severity and flood risk from the built-in road it runs along, so the typical-day traffic model still applies. Roads with no built-in counterpart get a typical value for their class.
- The built-in junctions, localities, landmarks and metro stations stay as the searchable places, each joined to its nearest OSM junction. Saved commutes keep working.
- OSM station positions replace the built-in ones line by line. Frequencies, colours and the "lines being built" switch stay as they are. Stations on different lines less than 300 m apart count as one interchange.
- Tertiary roads count as local roads: a little slower than secondary roads, and they take traffic from the built-in model only where they carry the same name as a built-in road. The map shows secondary roads once you zoom in and tertiary roads once you zoom in further.
- Because the OSM network has thousands of junctions instead of about 110, routes are searched at whole hours (once for weekdays and once for weekends) and then timed for the exact departure. The map draws secondary roads only once you zoom in.
- Add `?net=model` to the address to compare against the built-in network.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License. The page shows this credit on the map whenever it uses the data.

## Run the live version
```bash
python3 -m http.server 8000
```
Open http://localhost:8000/live/ and paste your API key. It is stored only in your browser.

Google Cloud setup: create a project with billing, enable **Routes API** and **Maps JavaScript API**, then create a key restricted to those APIs and to your site's address (`http://localhost:8000/*` or `https://<user>.github.io/*`).

Google bills per request, and the page calls it only when you press a button: Plan route is 1 request, Compare with Namma Metro is 1, and Check departures is 7.

## Deploy to GitHub Pages
Push this folder to a public repository, then turn on **Settings → Pages → Deploy from a branch → `main` / root**.
