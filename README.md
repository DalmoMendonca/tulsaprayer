# Tulsa Prayer Map

One-page 3D Tulsa neighborhood prayer map with moderated text and audio prayer submissions.

## Production Configuration

The production app uses Netlify Functions for server-side submission handling and Google Sheets as the persistent store.

Required Netlify environment variables:

- `OPENAI_API_KEY`: OpenAI API key used only by Netlify Functions.
- `GOOGLE_SCRIPT_URL`: deployed Google Apps Script web app URL connected to the storage sheet.
- `ADMIN_PASSWORD`: admin password for `/admin`; defaults to `dragonfly`.

Optional environment variables:

- `OPENAI_MODERATION_MODEL`: defaults to `gpt-5.4-nano`.
- `OPENAI_TRANSCRIBE_MODEL`: defaults to `gpt-4o-mini-transcribe`.

## Google Sheet Setup

The Google Drive connector may not have permission to create the Sheet automatically. If that happens:

1. Create a Google Sheet named `tulsaprayer-storage`.
2. Import `tmp/tulsaprayer-storage.xlsx` if it exists, or create tabs named `Prayers`, `Areas`, and `ModerationLog`.
3. In the Sheet, open Extensions -> Apps Script.
4. Paste `google-apps-script/Code.gs`.
5. In Apps Script settings, add Script Property `ADMIN_PASSWORD` with the same value as Netlify.
6. Deploy as a Web App, execute as yourself, with access set to anyone with the link.
7. Set Netlify `GOOGLE_SCRIPT_URL` to the deployed Web App URL.

Audio prayers are saved into a Google Drive folder named `tulsaprayer-audio`; the Apps Script makes each audio file available to anyone with its link so the public prayer wall can play it.

## Local Development

```bash
npm install
npm start
```

The server starts at `http://127.0.0.1:4173` by default.

### Environment variables

Copy `.env.example` to `.env` and fill in values as needed, or run with `ALLOW_UNMODERATED_LOCAL=1` to skip OpenAI moderation and Google Sheets (good for pure UI testing):

```bash
ALLOW_UNMODERATED_LOCAL=1 npm start
```

PowerShell:

```powershell
$env:ALLOW_UNMODERATED_LOCAL=1; npm start
```

### Changing the port

Set the `PORT` (and optionally `HOST`) environment variable:

```bash
PORT=3000 npm start
```

PowerShell:

```powershell
$env:PORT=3000; npm start
```

### "Port already in use" error

If you see `EADDRINUSE`, another process is using port 4173. Either stop that process or start on a different port as shown above.
