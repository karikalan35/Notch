# Islet (desktop starter, step 1)

A notch at the top of your screen. Hover it to open it.

## What works in this version
- Always-on-top notch, centered at the top of your main screen
- Click-through when closed, so it never blocks the apps under it
- Tabs: Music (demo player), Clipboard (real history), Widgets (clock, battery), Files (pick files, click a name to open it), Controls (volume, brightness, microphone)
- Buttons in the open notch: hide (minus) and quit (x)
- Tray icon: show or hide, start with Windows, quit
- Shortcut: Ctrl + Alt + N shows or hides the notch

## Run it on Windows
1. Install Node.js (LTS) from https://nodejs.org
2. Unzip this folder, open a terminal inside it (in File Explorer: right-click, Open in Terminal)
3. Run: npm install
4. Run: npm start
   (the first start downloads Electron, so give it a minute)

## Notes
- Clipboard history is kept in memory only. It is never saved to disk, and it will include anything you copy, passwords too.
- Closed notch is a solid black pill. Glass blur needs a Windows-specific step (planned for later).
- The notch uses your main display only.

- Controls use a small PowerShell helper (system.ps1). Brightness only works on laptop screens, not most external monitors. If a control does not work on your PC, the notch says so instead of crashing.
- Hide the notch with the minus button; Ctrl + Alt + N or the tray icon brings it back.
