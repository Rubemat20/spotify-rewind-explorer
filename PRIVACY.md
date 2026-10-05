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
4. Nothing is sent over the network, ever.
5. If **Remember on this device** is ticked (it is by default), the plays
   read from your file are also saved in your browser's own storage
   (IndexedDB) so a refresh doesn't mean uploading again. That copy lives
   only in that browser on that device -- the same place a website keeps
   anything it stores locally -- and is never sent anywhere. **Forget my
   data** at the bottom of the page deletes it. Clearing your browser's site
   data for this page does the same.
6. Untick **Remember on this device** before uploading and nothing is kept:
   refresh the page and it's gone (an older saved copy is deleted too).

On a shared or public computer, untick the box, or click **Forget my data**
when you're done, since anyone using the same browser could open the page and
see your listening history.

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

None. No Google Analytics, no pixels, no cookies, and no browser storage used
for tracking -- the only thing ever stored is your own listening data, in your
own browser, when you choose to keep it (see above). If a deployment of this project (including the maintainer's own
Vercel instance) ever adds analytics, that would be disclosed here first.

## If you fork or self-host this

You're responsible for your own deployment's privacy posture. The design
intent -- and the reason this architecture was chosen -- is that a fork
should be able to make the same "nothing leaves your browser" claim without
extra work, as long as you don't add a backend, analytics, or logging.

## Questions

Open an issue on the [GitHub repo](https://github.com/Rubemat20/spotify-rewind-explorer).
