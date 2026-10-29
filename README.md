<div align="center">

<img src="app/banner.png" alt="Kick" width="360">

### Kick for Samsung Smart TVs

Live streams, clips and chat on Tizen TVs, with the look and feel of Kick's Android TV app.

![Tizen](https://img.shields.io/badge/Tizen-4.0%2B-1428A0?style=flat-square)
![Tested](https://img.shields.io/badge/tested%20on-Tizen%205.0%20(2019)-53FC18?style=flat-square&labelColor=0B0E0F)
![Languages](https://img.shields.io/badge/languages-10-53FC18?style=flat-square&labelColor=0B0E0F)
![No build step](https://img.shields.io/badge/build-none%20(plain%20ES5)-555?style=flat-square)

<img src="docs/demo/demo.webp" alt="Demo: Home, Categories, Live, Search, a channel page and the player with chat" width="900">

</div>

## Features

- **Watch live** with chat, resolution choice and **rewinding** of the running stream
- **Continue Watching**: past broadcasts resume where you stopped
- **Home, Categories, Live, Following and Search**, in the layout of Kick's TV app; tabs open as
  soon as you move onto them
- **Search** shows who's live right now before you type, then channels, categories and livestreams
- **Top clips** of today, this week, this month or all time, and **sorting** of live channels
- **Streamer pages** with clips, recent broadcasts, schedule, recently streamed categories and bio
- **Subscribe, Join the Chat and Report** from the player, finished on your phone with a QR code
- **Raids** take you along to the raided channel, and level badges show in chat
- **Sign in with a QR code**, approved in the Kick phone app; **several accounts** on one TV
- **Fast on old TVs**: a background helper caches video and skips the TV's slow name lookups
- **10 languages**: English, Español, Deutsch, Português, Français, 中文, 日本語, 한국어, हिन्दी, العربية.
  The app speaks your TV's language, and lists streams in your country's language, until you
  choose otherwise
- **Content settings**: content language (all 27 of Kick's), hide gambling, 18+ or pools / hot tubs
  streams, and a warning before 18+ content
- **Update check** with changelog, and **Report a problem** straight from the TV

## Compatibility

| Tizen | Samsung TVs | Status |
|---|---|---|
| 5.0 | 2019 | ✅ Tested (RU7379) |
| 4.0 | 2018 | Should work, not tested yet |
| 5.5 and newer | 2020+ | Should work, not tested yet |
| 2.3 – 3.0 | 2015 – 2017 | Not supported |

## Install on a TV

**Before you start:** on the TV, open **Apps**, type `12345` with the remote, switch
**Developer Mode** on, and enter the IP address of the PC or phone you install from. Restart the TV.

### With Apps2Samsung

[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) signs and installs the app for you.
Kick is in its app catalog, so you don't have to download anything yourself.

1. Install [Apps2Samsung 3.0 or newer](https://github.com/Apps2Samsung/Apps2Samsung/releases) on your PC or phone.
2. Pick your TV, find **Kick** in the app list and press **Install**. The first time, sign in with
   your Samsung account so Apps2Samsung can make a certificate for your TV.

To install a downloaded package instead, take `Kick-<version>.wgt` from the
[latest release](../../releases/latest) and choose **Custom WGT File** in Apps2Samsung.

From the command line (Apps2Samsung CLI):

```
apps2samsung-cli install Kick --tv <tv-ip>
```

## Updates and problems

Once a day the app asks GitHub whether there's a newer release. If there is, a green dot appears
on the profile button, and **Account → Updates** shows what's new. Install it the same way as
the first time: with Apps2Samsung (TV-Store too, if it's on your TV).

Something not working? **Account → Report a problem** shows a QR code that opens a new
[issue](../../issues) on your phone, with your TV model, Tizen version and app version already
filled in.

## Build

```
python3 build.py
```

This packages `app/` as `dist/Kick-<version>.wgt` (the version comes from `app/config.xml`).
There is nothing to compile: the app is plain ES5 for the TV's old browser engine.

> [!IMPORTANT]
> Certificates and signature files are listed in `.gitignore`. Never commit them.

## How it works

`service/helper.js` is a small background service that starts with the app and listens only on
`127.0.0.1` (port 47820, and 47821 for pictures). It exists because:

- The TV's media player can't read Kick's gzip-compressed playlists.
- The TV looks up every new server name in 5–10 s; the helper does it in ~50 ms.

On top of that it keeps connections open, caches video segments in memory (48 MB), reads ahead
about 24 s in clips and videos, and starts rewinds right at the chosen point of the recording.
It only fetches from `*.kick.com` and Kick's video CDN (`*.live-video.net`), over HTTPS.

## Privacy

The app has no accounts of its own, no analytics and no ads. It talks to:

- **Kick** (`*.kick.com`, `*.live-video.net`) for streams, chat, sign-in and pictures. This also
  tells the app which country it's in, for the default content language.
- **GitHub** (`api.github.com`), once a day, for the update check. Nothing about you or your TV
  is sent.

Your Kick sign-in stays on the TV until you log out.

## Project layout

| Path | What |
|---|---|
| `app/` | The Tizen web app (`config.xml`, `index.html`, `js/`, `css/`, `img/`, `fonts/`) |
| `app/service/helper.js` | The background helper service |
| `app/js/i18n-data.js` | All translations (Kick's own where the official app has the same text) |
| `app/js/update.js` | The update check and changelog |
| `build.py` | Packages `app/` as a `.wgt` |
| `docs/demo/` | The demo animation in this README |

## Credits

- [Inter](https://rsms.me/inter/) typeface: SIL Open Font License 1.1 (`app/fonts/OFL.txt`)
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase: MIT

---

<sub>Not affiliated with Kick. The Kick name, logo, icons and translations taken from Kick's app
belong to Kick.</sub>
