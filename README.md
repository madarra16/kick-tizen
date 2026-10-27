# Kick for Samsung Smart TV (Tizen)

A Kick app for Samsung TVs running Tizen 5 or newer, modelled on Kick's Android TV app. It was
built and tested on a 2019 Samsung RU7379 (Tizen 5.0).

- Home with featured carousel, categories, live channels, following, search
- Live player with chat, resolution choice and rewinding of the running stream
- Streamer pages with clips and past broadcasts
- Sign-in with a QR code, approved in the Kick phone app
- 10 languages (es, en, de, pt, fr, zh, ja, ko, hi, ar), content language and content filters

Not affiliated with Kick. The icons, logo, QR codes and many translations come from Kick's own
app and belong to Kick.

## Layout

| Path | What |
|---|---|
| `app/` | The Tizen web app (`config.xml`, `index.html`, `js/`, `css/`, `img/`, `fonts/`) |
| `app/service/helper.js` | Background service that does the app's networking (see below) |
| `i18n/build_i18n.py` | Generates `app/js/i18n-data.js` (all translations) |
| `art/make_banner.py` | Generates the app icon `app/banner.png` from Kick's wordmark |

The app is plain ES5 for the TV's Chromium 63; there is no build step.

## Install on a TV

1. Put the TV in Developer Mode (Apps, then type `12345`) and enter this PC's IP address.
2. Sign and install `app/` with a Samsung certificate made for this TV, for example with
   Tizen Studio or the AeroTizen CLI:

   ```
   aerotizen --tv <tv-ip> install app
   ```

Certificates and signature files are listed in `.gitignore`: never commit them.

## The helper service

`KickLive01.Helper` (Node 4.4 on Tizen 5) starts with the app and listens on `127.0.0.1` only:

- Port 47820: Kick API calls (`/f`), HLS playlists (`/p.m3u8`), video segments (`/s.ts`), `/stats`
- Port 47821: the same server for pictures, so thumbnails never queue in front of API calls

Why it exists: the TV's media player can't read Kick's gzip-compressed playlists, and the TV's
own name lookups take 5–10 s per server. The helper resolves names itself (~50 ms), keeps
connections open, caches video segments in memory (48 MB), reads ahead about 24 s in clips and
videos, and serves rewinds from the right point of the recording.

It only fetches from `*.kick.com` and Kick's video CDN (`*.live-video.net`) over HTTPS.

## Translations

`i18n/build_i18n.py` takes Kick's own translations from the decompiled official APK where the
app uses the same text, plus its own table for the rest:

```
python3 i18n/build_i18n.py <res folder of the decompiled Kick APK>
```

## Licences of bundled code

- Inter typeface: SIL Open Font License 1.1 (`app/fonts/OFL.txt`)
- qrcode-generator by Kazuhiko Arase: MIT (header in `app/js/vendor/qrcode.js`)
