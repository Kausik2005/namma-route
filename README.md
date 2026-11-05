# Namma Route

A Bengaluru commute planner that answers three questions: which road, which hour, and whether the metro would be quicker.

| Page | Data | Needs |
| --- | --- | --- |
| `index.html` | ~420 searchable places (localities, landmarks, metro stations) on a built-in model of ~110 junctions (Nelamangala to Hoskote, Bidadi to Attibele), the arterial roads and NICE Road, and the Purple, Green and Yellow metro lines (Pink and Blue optional), with a typical-day traffic model | Nothing; works offline |
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
- **Multiple stops:** up to 6 stops (offline) or 8 (live), put in the fastest order. Also car or two-wheeler, avoid tolls, rain mode, and handoff to Google Maps.

## Run the live version
```bash
python3 -m http.server 8000
```
Open http://localhost:8000/live/ and paste your API key. It is stored only in your browser.

Google Cloud setup: create a project with billing, enable **Routes API** and **Maps JavaScript API**, then create a key restricted to those APIs and to your site's address (`http://localhost:8000/*` or `https://<user>.github.io/*`).

Google bills per request, and the page calls it only when you press a button: Plan route is 1 request, Compare with Namma Metro is 1, and Check departures is 7.

## Deploy to GitHub Pages
Push this folder to a public repository, then turn on **Settings → Pages → Deploy from a branch → `main` / root**.
