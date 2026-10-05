# Rewind Explorer

Pick any artist from your own Spotify listening history and get a full,
Wrapped-style breakdown of them: plays over time, most-played tracks, when
you listen, how shuffle vs. deliberate replays split, and how every edition
of a release (original, deluxe, "Taylor's Version," whatever) stacks up
against each other.

Or switch to **Top Five by year** for a Wrapped-style recap of every year in
your history: top five artists, songs and albums (by minutes or by plays),
total minutes, your biggest day, streaks, when you listen, new vs. returning
artists, a listening personality, and a year-over-year comparison. A toggle
flips between the **Full Year** (Jan 1 -- Dec 31) and the **Wrapped window**
(Jan 1 -- Nov 15, the stretch Spotify's Wrapped roughly covers) and shows what
changed in the rankings between the two.

**Everything runs in your browser.** There is no backend, no database, no
upload endpoint. The moment you drop your Spotify export in, the page reads
it and crunches it right there. Nobody but you ever sees it -- including
whoever's running this deployment. With **Remember on this device** ticked
(the default), your plays are also kept in your own browser's storage so a
refresh doesn't mean re-uploading; **Forget my data** at the bottom of the
page deletes them. Untick it and everything is thrown away on refresh.

## Sample output

<table>
<tr><td><img src="docs/taylor-swift.png" width="280" alt="Taylor Swift dashboard, showing plays over time, by-era breakdown, and rising/cooling tracks"></td>
<td><img src="docs/ed-sheeran.png" width="280" alt="Ed Sheeran dashboard, including his +, -, =, x album titles handled correctly"></td>
<td><img src="docs/noah-kahan.png" width="280" alt="Noah Kahan dashboard, showing a 2026 breakout in the listening-over-time chart"></td></tr>
</table>

Three real dashboards, same page, three different data shapes: Taylor Swift
(lots of "Taylor's Version" reissues, folded into one era each), Ed Sheeran
(whose actual album titles are math symbols -- `+`, `-`, `=`, `x` -- and yes,
that's really how they're released), and Noah Kahan (a much smaller library
with a visible 2026 breakout in the timeline).

## Using it

1. Request your **Extended Streaming History** from Spotify: go to
   [spotify.com/account/privacy](https://www.spotify.com/account/privacy/),
   log in, and request it under "Download your data." (This is different
   from the basic account-data export -- make sure you pick the one called
   *Extended streaming history*.)
2. Spotify emails you a download link within a few days.
3. Open this site, drop the `.zip` it sends you (no need to unzip it first),
   and search for any artist you've played at least 3 times.

## Running it yourself

It's a static site -- no build step, no dependencies to install.

```bash
git clone https://github.com/Rubemat20/spotify-rewind-explorer.git
cd spotify-rewind-explorer
python -m http.server 8000   # or any static file server
```

Then open `http://localhost:8000`.

## Deploying your own copy

Fork this repo, then on [vercel.com](https://vercel.com) choose
**Add New -> Project -> Import Git Repository** and point it at your fork.
No build command, no environment variables, no framework preset needed --
it's plain HTML/CSS/JS. Vercel serves it as-is.

## How it works

- `js/upload.js` reads whatever you drop -- a `.zip`, loose `.json` files, or
  a folder -- using [JSZip](https://stuk.github.io/jszip/) to unpack archives
  in-browser, and keeps only the `Streaming_History_Audio_*.json` entries
  (video/podcast history is ignored).
- `js/aggregate.js` does the actual analysis: per-artist monthly trends, a
  "same song, every edition" merge that folds a single's plays into its
  parent album, era detection (folds "Album (Deluxe)" / "Album (Taylor's
  Version)" / etc. into one umbrella when it's genuinely a reissue), rising
  vs. cooling tracks (comparing the first half of your history against the
  second), shuffle-vs-repeat, and more.
- `js/topfive.js` builds the **Top Five by year** data in one pass -- every
  year, both windows -- so the toggle is instant. It differs from the artist
  view on purpose:
  - **Local time.** Days, hours and weekdays use your browser's time zone
    (the artist view buckets in UTC).
  - **30-second rule.** Only plays of 30s or more count, which is how
    Wrapped defines a stream, so play counts can run a little lower than
    the artist view's.
  - **Wrapped window.** Jan 1 through `WRAPPED_CUTOFF` (Nov 15 by default --
    Spotify describes Wrapped as covering January through mid-November),
    with Private Session plays left out the way Wrapped leaves them out.
    Change the constant at the top of the file to move the cutoff.
  - **Ties** share a rank (1, 2, 2, 4), and everyone tied for #5 is shown.
  - **Partial years** are flagged: a year still in progress, an export that
    ends early, or a history that starts mid-year. An incomplete year is
    compared against the same dates of the year before.
  - Genres and podcasts aren't covered: the export has no genre data, and
    podcast plays are dropped at upload.
- `js/saved.js` handles **Remember on this device**: it keeps the slimmed
  play records in the browser's IndexedDB (never on a server) and restores
  them on the next visit, re-running the analysis. Saves carry a version
  number; bump `SAVE_VERSION` if the record shape in `upload.js` ever changes
  and older saves are dropped instead of misread.
- `js/app.js` renders it all as hand-built SVG/DOM charts (no charting
  library) and wires up the artist search and the view tabs.

## Tests

The Top Five aggregation has tests built on Node's built-in test runner (no
packages to install; Node 18+):

```bash
node --test
```

They use synthetic records only -- never commit a real streaming-history export.

No analytics, no cookies, no tracking pixels. The only network requests this
page makes after it loads are to Google Fonts and the two CDN scripts
(JSZip, html2canvas for the "Save as PNG" button) -- never your data.

## Privacy & legal

- [PRIVACY.md](PRIVACY.md) -- what happens to your data (short version: nothing, it never leaves your browser)
- [TERMS.md](TERMS.md) -- terms of use, accuracy disclaimer, no-warranty
- Not affiliated with, endorsed by, or sponsored by Spotify AB. "Spotify" and
  its logos are trademarks of Spotify AB, referenced here only to describe
  compatibility with Spotify's own data export format. This project does not
  use the Spotify API and never asks for your Spotify login.

## License

MIT -- see [LICENSE](LICENSE). Fork it, rename it, make it yours.
