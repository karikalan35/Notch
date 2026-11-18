# Islet (desktop)

A notch at the top of your screen. Hover it to open it. The pin button turns Always on top on or off (remembered between runs; the tray menu has the same switch). Hide it with the eye button; Ctrl + Alt + N or the tray icon brings it back. Quit from the tray icon (right-click, Quit Islet).

## Run it on Windows
1. Install Node.js (LTS) from https://nodejs.org
2. Open a terminal in this folder and run: npm install
3. Run: npm start   (the first start downloads Electron)

## Closed notch
Time on the left, battery on the right. A small wave shows while media plays. Orange, green and blue dots fade in when another app uses the microphone, camera or location.

## Tabs
- **Media**: the banner on the left shows the cover or video thumbnail with the playing app's icon in its corner (if an app gives no cover, the app's own icon is shown large instead). If the cover never appears, details are written to %TEMP%\islet-media.log. On the right: title, a progress bar (click or drag it to jump to a point), and play/pause, previous and next centred underneath. Play/pause reacts at once. If an app refuses a normal request, the matching media key is pressed instead. If two things play, the one actually playing wins.
- **Clipboard**: recent copies. Click one to copy it again. Each item has a pin (keeps it at the top, and it is remembered after a restart) and a delete button. Clear all removes everything except pinned items, like the Windows clipboard history. Only pinned items are ever saved to disk.
- **Widgets**: time and date, battery, PC uptime.
- **Files**: drop files onto the closed notch or into the tab, or use Add files. Drag a file from the shelf onto the desktop, a folder or another app; Windows receives a copy of the real file. Click a name to open it.
- **Controls**: volume, brightness (laptop screens), Wi-Fi, Bluetooth, Dark Style, Night Light, Airplane and Microphone. The arrow on Wi-Fi opens a network list inside the tab (connect, disconnect, enter a password); the arrow on Bluetooth lists paired devices and whether they are connected. Nothing opens the Windows Settings app. Night Light is Islet's own warm screen tint; it turns off when you quit.
- **Apps**: the + tile opens a list of installed apps (from your Start Menu). Click one to add it; search by name; Browse... picks any .exe or shortcut on the PC. Click a tile to launch it; hover a tile and click x to remove it.

## Notifications and reminders
- **Charger connected**: a small pill drops out of the notch for a few seconds (charger icon and battery percentage), then the notch goes back to what it was doing.
- **Battery full**: when the battery reaches 100% while charging, the same pill says "Fully charged".
- **Reminders**: click the bell button (next to the pin) while the notch is open. Type the message, pick a time (or +5 min / +15 min / +1 hour) and press Add. If the time already passed today the reminder is set for tomorrow. Reminders are saved and survive a restart.
- When a reminder is due the notch grows into a full notification screen with the message and its scheduled time. It stays long enough to read (longer for longer messages; hovering it pauses the countdown). **Dismiss** closes it, **Snooze 5 min** brings it back later. If the notch was hidden it comes back for the reminder and hides again afterwards.
- Several notifications wait in line, so they never overlap. A battery pill waits while the notch is open.
- To see them without waiting: tray icon, right-click, Test notifications.

## Shape
The top corners of the notch curve outward into the screen edge, like the MacBook notch.

## Notes
- The window is only as big as the notch while it is closed (so files can be dropped on it) and grows while open.
- While the pin is on it stays above other windows, including full-screen windows (not exclusive full-screen games). With the pin off it behaves like a normal window. It uses your main display.
- Store (UWP) apps that have no Start Menu shortcut do not appear in the app list yet; add them with Browse if they have an .exe.
- The search box in the Apps picker lets the notch take keyboard focus while it is open.
- Helpers: system.ps1 (volume, brightness, radios, theme, Night Light), media.ps1 (now playing), net.ps1 (Wi-Fi and Bluetooth lists). A helper that stops by accident is started again. If something is not available on your PC the notch says so instead of crashing.
