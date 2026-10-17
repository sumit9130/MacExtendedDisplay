# MacDisplay

A live dashboard for your Mac's second display: big clock and date, CPU / memory / disk / network, weather for where you are, now playing, calendar, world clocks and a focus timer. 7 layouts and 12 themes (10 animated), tuned to stay light on CPU.

This folder holds the native Mac app (source) and a browser version as a fallback.

## Build the app (about a minute, once)

1. Install Apple's Command Line Tools if you don't have them: `xcode-select --install`
2. In Terminal: `cd` into this folder (type `cd `, drag the folder in, press Enter), then run:

       bash build.sh --install

   This compiles `MacDisplay.app`, puts it in Applications and opens it. Use `bash build.sh` without `--install` to build in this folder only.

Because you build it yourself, macOS shows no "unverified developer" warning. Needs macOS 13 or newer.

If the build prints errors, send me the text and I'll fix it.

## First launch

- With a second display connected, MacDisplay opens full screen on it. With one display it opens in a window.
- **Location:** macOS asks to allow Location Services. That is what makes the weather follow you. If you say no, it falls back to an approximate location from your internet address.
- **Music / Spotify:** macOS asks once for permission to read the current track (only if the player is already running).

## Displays coming and going

- Unplug the display (or let it sleep) and MacDisplay steps back to a normal window on your Mac. Plug it back in and it returns to that display, full screen, by itself.
- It survives sleep and wake the same way, and it remembers your choice even if the display was missing at launch.
- Two identical monitors are told apart by their serial number when they have one. Monitors without a serial are told apart by the port they use, so swapping ports may swap them: re-pick the display from View > Display.
- This relies on System Settings > Desktop & Dock > "Displays have separate Spaces" being on (the default).
- One layout and theme is shared by all displays. Separate setups per display are not included.

## Menu bar

- **Layout:** Dashboard, Big Clock, Analog + Calendar, System Monitor, Focus Timer, World Clocks, Ambient (Cmd+1 to Cmd+7)
- **Theme:** Neon Night, Aurora, Synthwave, Terminal, Cosmos, Deep Ocean, Sakura, Embers, Rainfall, Midnight Snow, Mono, Paper (Cmd+] / Cmd+[ for next / previous)
- **Weather:** Use My Location (automatic), or Choose City
- **View:** full screen (Ctrl+Cmd+F), which display to use, Animation (Smooth / Eco / Still), options (24-hour, seconds, scanlines, °F), world clock cities, focus timer lengths
- **MacDisplay menu:** Keep Display Awake (on by default), Open at Login

Keys in the window: T theme, D layout, 1-7 layout, F full screen, H 12/24 h, S seconds, E animation, M settings panel. In the focus layout: Space start/pause, R reset, N skip.

## Keeping CPU low

Animation drops to Eco on battery and stops when the window is hidden. Mono and Paper have no animation. Use View > Animation > Still for zero animation cost.

## Privacy

Everything runs on your Mac. The only network calls are weather (open-meteo.com), plus a reverse-lookup of your city name if macOS can't provide one and the approximate-location fallback (ipwho.is, then geojs.io). Settings are stored in the app's preferences.

## Browser version (fallback)

`browser/start.command` runs the same interface in your browser using Python 3 (installs `psutil` the first time). Run `xattr -dr com.apple.quarantine .` in the folder once if macOS blocks it. Location then uses the browser's own permission prompt.

## Files

- `Sources/` Swift code (window, menus, system stats, location)
- `Resources/web/` the interface (shared by the app and the browser version)
- `Resources/Info.plist`, `Resources/AppIcon.icns` app metadata and icon
- `build.sh` builds the app

## Get a ready-made app without building (GitHub)

1. Create a free private repository on github.com and upload this folder's contents (keep the `.github` folder).
2. Open the repository's **Actions** tab, choose **Build MacDisplay**, and wait about 3 minutes.
3. Download the **MacDisplay** artifact, open `MacDisplay.dmg` and drag the app to Applications.
4. Because it is downloaded, macOS blocks the first launch: right-click the app, choose Open, then Open again. Or run `xattr -dr com.apple.quarantine /Applications/MacDisplay.app` once.
