# Privacy

Rewind Explorer has no backend. There is nothing here to write a privacy
policy about collecting, storing, or selling your data, because none of
that happens.

## What this page does with your file

When you drop your Spotify Extended Streaming History (a `.zip` or a folder
of `.json` files) onto this page:

1. Your browser's built-in File API reads the file(s) into memory.
2. If it's a `.zip`, [JSZip](https://stuk.github.io/jszip/) (loaded from a
   CDN, running entirely client-side) unpacks it in memory.
3. `js/aggregate.js` computes the stats you see -- monthly trends, top
   tracks, and so on -- in a JavaScript variable in your browser tab.
4. Nothing is written to disk, sent over the network, or persisted anywhere.
   Refresh the page and it's gone.

There is no server-side code in this project. It cannot receive your data
even if it wanted to -- there's no endpoint for it to be sent to.

## Network requests this page makes

Opening the page loads, from CDNs, over HTTPS:

- Google Fonts (Fraunces, Public Sans, IBM Plex Mono)
- JSZip (`cdnjs.cloudflare.com`) -- only used if you drop a `.zip`
- html2canvas (`cdnjs.cloudflare.com`) -- only used if you click "Save as PNG"

None of these requests carry any of your listening data. They fetch static
font/script files, full stop.

## Analytics, cookies, tracking

None. No Google Analytics, no pixels, no cookies, no localStorage use for
tracking. If a deployment of this project (including the maintainer's own
Vercel instance) ever adds analytics, that would be disclosed here first.

## If you fork or self-host this

You're responsible for your own deployment's privacy posture. The design
intent -- and the reason this architecture was chosen -- is that a fork
should be able to make the same "nothing leaves your browser" claim without
extra work, as long as you don't add a backend, analytics, or logging.

## Questions

Open an issue on the [GitHub repo](https://github.com/Rubemat20/spotify-rewind-explorer).
