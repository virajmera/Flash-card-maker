# Flashcard Maker

A small, static flashcard app. No accounts, no build step, no backend.

## Features

- **Decks** by subject or class, with a title and optional description
- **Cards** with a question, an answer, and optional example and image URL
- **Study mode** shows one side at a time; reveal the answer, then rate it
- **Ratings:** Again (returns this round), Hard, Got it
- **Progress:** reviewed count, reviewed today, due now, cards that need practice
- **Search and edit** cards inside a deck
- **Autosave** to the browser, so a refresh keeps your work
- **Study filters:** all, due, starred, or missed; optional shuffle
- **Keyboard:** Space or Enter reveals, 1/2/3 rate, S stars the current card
- **Simple spaced repetition:** good cards come back further apart, hard ones sooner
- **Import** from pasted text (`question | answer | example`), or CSV
- **Export** a deck as JSON or CSV, export everything as a backup, or copy a share link
- **Mobile-friendly** and **offline** after the first visit (service worker)

## Accounts and cloud sync (optional)

Without an account, progress stays in the browser. With one, decks sync across devices. The backend is [Supabase](https://supabase.com) (free tier).

1. Create a Supabase project.
2. In the SQL Editor, run `supabase-setup.sql`. It creates the `decks` table with row-level security, so each user only sees their own decks.
3. Copy the project URL and anon public key (Project Settings → API) into `config.js`.
4. In Supabase, under Authentication → Providers, keep Email enabled. Turn off "Confirm email" if you don't want sign-up confirmation.

With `config.js` left empty, the sign-in button is hidden and the app works as before.

How sync works: each deck is stored as one row. Changes upload a few seconds after you edit. When signed in, the newer copy of each deck wins. On sign-out the device's decks are cleared, so the next person doesn't see them.

## Run locally

Any static server works. For example:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy on Vercel

1. In Vercel, choose **Add New → Project** and import `virajmera/Flash-card-maker`.
2. Framework preset: **Other**. Leave the build command empty and the output directory as `.`.
3. Deploy. Every push to the repo redeploys.

## Notes

- Data is stored in the browser's `localStorage`. It is per-browser and per-site. Use **Export all** to keep a backup.
- Share links put the deck in the URL fragment (`#share=…`). Nothing is sent to a server, but long decks produce long links.
- Image URLs must be `http://` or `https://`.
- After changing the app files, bump `CACHE` in `sw.js` so returning visitors get the update.

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | Styles (light and dark) |
| `app.js` | All app logic: storage, study, import/export |
| `sw.js` | Offline cache |
| `manifest.webmanifest` | Install-to-home-screen metadata |

## Later

Accounts and sync are intentionally left out for now. This project is kept separate so it can be merged into the main site later.
