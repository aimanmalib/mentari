# 0032. Build the demo video outside git, from live captures

Date: 2026-11-24. Status: accepted.

## Context

The fest asks for a video of up to three minutes. The video has to show the product, not slides about it: the live
registry, a real "Retire now", the three failure buttons, the signed meter readings and `pnpm verify`. Every number on
screen has to come from the testnet or from a test run, and the narration has to say it is an AI voice.

A rendered film is a 15 to 25 MB binary. Each new render would add another copy to the history of a public repository,
and the history cannot be rewritten after it is pushed.

## Decision

- The video workspace is `video/`, ignored by git. It holds the capture script, the narration lines, the film source,
  the rendered MP4 and a build record (`JANA.json`) with the SHA-256 of the MP4, the voice line hashes and the loudness
  measurements.
- The screens are full-page captures of the live site at `https://mentari.sasateguh.com`, taken with Playwright at
  1280 CSS px and scale 2, with real clicks: one "Retire now" and the three failure buttons, each a testnet
  transaction. The on-screen evidence panels are excerpts of `evidence/testnet.json`, and the terminal is the output of
  one real `pnpm verify` run. A small script writes these values into the film data, so no number is typed by hand.
- The narration is a clone of my own voice made with ElevenLabs, and the end card says so. The music is by Sascha
  Ende, ende.app, under CC BY 4.0, credited on the end card and in the README.
- The film is about 103 seconds, 1920x1080, normalised to between -16 and -17 LUFS with true peaks at or under
  -1.5 dBTP.
- The MP4 is published as an unlisted YouTube video by me. A copy goes on the demo site only after I have watched it.

## Consequences

- The repository does not contain the film or its sources. A reader checks the claims in the film with the same
  tools the film shows: the live site, `evidence/` and `pnpm verify`.
- The capture sends four testnet transactions from the demo account each time it runs.
- A change to the site or the evidence after the capture is not in the film until it is captured and rendered again.

## How to undo

Delete the `/video/` line from `.gitignore` and commit the workspace without the rendered MP4, or replace the film with
a plain screen recording of the same steps.

## Addendum, 2026-11-28: the full-size copy on the demo site

### Context

The demo video is an unlisted YouTube video. A judge on a network that blocks YouTube, or a judge who wants the file,
has only the smaller 1600 px copy in the repository (decision 0039). The decision above put a full-size copy on the demo
site once I had watched the film. I have watched it and published it, so the copy can go up now.

The film is 20 MB. Baking it into the image would add 20 MB to every image and to the rollback image held next to it,
on a host disk shared with other projects. The static file handler reads a whole file into memory and has no byte
ranges, so a player could not seek and a few parallel downloads would press on the 256 MB memory limit.

### Decision

- The MP4 lives on the host, outside the repository and the image, in `MENTARI_VIDEO_DIR` (`deploy/hos.env`). Compose
  mounts it read-only at `/srv/video`.
- `config/app.json web.links.videoCopy` holds the public route (`/video/mentari.mp4`), and `web.videoCopyFile` the
  size in bytes, the SHA-256 and the cache time. The server serves the file of that name only when its size matches, streams it, and answers single byte
  ranges with 206 and ranges past the end with 416, so players can seek.
- The proxy route does not compress `video/mp4`. Compressed, the reply lost its length and byte ranges, and
  Cloudflare cached that copy until it was purged.
- `deploy/deploy.sh` checks the SHA-256 of the host file against the config before it builds, and stops if the file is
  missing or different.
- The home page caption under the poster links to the copy, in English and Malay, with the size worked out from the
  config. Both READMEs link to it next to the YouTube link.

### Consequences

- The image stays the same size. A new film means a new file in the folder and new values in `web.videoCopyFile`.
- Cloudflare caches the file at the edge for the configured time, which keeps the 20 MB off the host for most visits.
- If the folder is empty the route answers 404 and the rest of the site is unaffected.

### How to undo

Set `web.links.videoCopy` to `""` (the link goes and the route closes), or remove it and the `web.videoCopyFile` block, the mount
in `deploy/compose.yaml`, `video_check` in `deploy/deploy.sh`, `server/src/video.ts` and its tests.
