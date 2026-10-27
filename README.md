# Azure Echo

A memory/reflex arcade: watch the lights, listen, repeat. Four zones, one signal.
Installable as an app (PWA) with optional accounts and a global leaderboard.

- **Website (the game):** plain HTML, CSS and JavaScript. No install, no build step.
- **Server (accounts + leaderboard):** one C# file in `server/`. Optional: without it everyone plays as a guest and scores stay on their device.

## Run it on your computer (VS Code)
1. Install the **Live Server** extension, right-click `index.html`, choose **Open with Live Server**.
2. For accounts: install the .NET SDK, then run `dotnet run --project server` (http://localhost:8080). The website finds it by itself on localhost.

## Deploy
- Website: push to GitHub, import in Vercel (Framework Preset **Other**, no build command).
- Server: host `server/` on a .NET-friendly host. Set `ALLOWED_ORIGIN` to your Vercel URL
  and `DATA_DIR` to a folder on a persistent disk. Then put its address in `js/config.js` (`API_URL`).

## Install as an app
Open the deployed site in Chrome/Edge (or Safari on iPhone: Share > Add to Home Screen) and choose **Install app**.
After changing files, bump the version number in `sw.js` (`CACHE`) so players get the update.

## Folders
```
index.html            the page
manifest.webmanifest  app name, icons, colours (makes it installable)
sw.js                 offline support
css/styles.css        the look
js/game.js            game rules
js/app.js             screens, input, saving, login, install
js/config.js          address of the C# server
assets/               art and sounds
server/               C# server (accounts, progress, leaderboard)
```
