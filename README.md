# Vid Vision (desktop app for Windows and Mac)

Vision Engine + Voice Engine + Scribe Engine in one Electron app. Each module is sold separately and unlocked by the
**Vid Vision Server** WordPress plugin (licences, 5 registration URLs, JVZoo/WarriorPlus IPN, Agency and White Label).

## Modules

| Module | Tools |
|---|---|
| Vision Engine | Discover (YouTube search, 11 ranking modes, 40 markets, CC filter, channel/playlist scan), Analysis (key frames + transcript + vision model → report, side-by-side models, translate, Watch with Gemini), Findings (12 lenses + custom question, frame-cited), Assets (searchable frames, save at source resolution), Clips (AI highlights, 9:16 / 1:1 / 16:9, crop / fit+blur / split, burned-in word-highlight captions), Documents (12 types → PDF, Word, web page, Markdown, text; translate), Posts (WordPress + LinkedIn, Facebook, Instagram, X, Pinterest; publish draft/now/scheduled), Images (30 layouts × 11 formats; OpenAI, Gemini, OpenRouter, fal.ai or copy prompt), Chat (project or video, clickable timestamps, attachments), Export knowledge (Brief / Standard / Complete, .md/.txt) |
| Voice Engine | Quick TTS (Kokoro + Piper local/free, OpenAI, Gemini, ElevenLabs, custom server; 28 style presets, speed, AI write, translate, Jamendo music beds with ducking, trim, 5 export formats), Voice Clone (record, file, link, library → ElevenLabs IVC), Voice Lab (describe up to 4,000 chars, chip builder, analyze audio, prompted voices), Studio (AI script + auto-cast, per-line direction/regenerate, translate all, music + Freesound/AI SFX, document import, loudness-matched stitching), Audiobooks (txt/md/docx/pdf/srt/vtt/lrc/sbv, chapters, single narrator or AI full cast, chapter renders, M4B with chapter markers, single-line re-render), Voice library, Audio library, backup/restore |
| Scribe Engine | Transcribe (file, link, mic), Bulk transcribe grid (playlists/channels, captions, AI prompt per row, translate, sortable/filterable, project files), editor with synced player, find/replace, exports TXT/SRT/VTT/CSV/JSON, 83-prompt library in 10 categories + custom prompts (import/export), combined and merged AI results, Translate (200+ languages, AI or offline NLLB-200, timestamps preserved, multi-language in one run), Downloader, Link extractor |

**Built-in AI (default, 1.1+).** Buyers never enter an API key or choose a model. The app gets a short-lived signed plan
token from the licence site and sends AI work to the Vid Vision AI gateway (`vid-vision-gateway` package, Cloudflare
Worker), which charges the buyer's monthly credits and sends each job to your VPS voice server (`vid-vision-voice-server`:
54 natural voices, cloning, voice design, transcription) or Cloudflare Workers AI (writing, video frames, images), with
optional backup providers. It covers writing and chat, video-frame analysis, transcription (split into parts and sent
several at a time), natural voices, private cloned/designed voices, AI sound effects, images, and the free music /
sound-effect libraries. Credits, limits and credit packs are managed in wp-admin; the sidebar shows
credits left and an out-of-credits message offers a "Buy credits" button.

Offline engines (free, no credits): Whisper (whisper.cpp, 6 models + custom + Hugging Face links, CPU or NVIDIA CUDA 12),
Kokoro (54 voices, 8 languages) and offline voice cloning/design (sherpa-onnx: Kokoro v1.0 + ZipVoice), NLLB-200, Piper,
Ollama models (one-click install, curated list, any GGUF model from a Hugging Face link), LM Studio.
**Settings → Offline engines → Check for new models** updates yt-dlp / Whisper / Piper and shows new models you add in
wp-admin (Model catalogue). Every update keeps the previous version — **Revert** puts it back.

**Private mode** (Settings → Built-in AI): nothing goes to the online AI — writing uses the local model, transcription uses
offline Whisper, voices use offline Kokoro, translation uses offline NLLB (or the local model). No credits are used.

**Unlimited plans:** tick *Unlimited AI (fair use)* on a product in wp-admin; the monthly fair-use limit pauses an account
until the 1st if it is reached (needs AI gateway 1.1.0).

Advanced mode (vendor only — press **Ctrl+Shift+K** on the Settings page, or start with `AME_ADVANCED=1`) shows the
own-key engines again: OpenAI, Claude, Gemini, OpenRouter, xAI, Mistral, DeepSeek, Perplexity, Groq, ElevenLabs, Gladia,
fal.ai, Jamendo, Freesound, custom servers and "Watch with Gemini". Requests made with own keys use no credits.

## What's new in 1.3

- Built-in AI runs on your VPS voice server + Cloudflare (needs AI gateway 1.2.0). Customers install nothing.
- Settings no longer shows model or image-provider choices to buyers: each feature is **Built-in AI** or
  **This computer (offline)** (Settings → Built-in AI → Where the AI runs). Offline engines stay optional;
  installed Ollama models get **Use for writing / Use for video frames** buttons. Advanced mode still shows everything.
- Built-in voices come from the server: 54 natural voices in 8 languages (plus any-language voices when the gateway has an
  OpenAI backup key), real speed control, and one voice kept across the parts of long scripts.
- The server sets part sizes: voice text (~1,200 characters), cloned-voice text (~600 characters, one at a time),
  transcription parts (~3 minutes) and video frames per request (4, sent three requests at a time).
- Video frames go to the AI at 512 px wide: same descriptions, about a third of the cost.
- Cloning defaults to the built-in server (nothing to download); cloned voices speak English and Chinese.
- Studio "translate all" picks a natural voice made for the new language.
- Infographics ask the server for its text-friendly image engine; square images use the low-cost one.
- Offline Kokoro now reads every English word (words missing from its word list were skipped before).
- Default licence server: https://vidvision.aipowerlessons.com.

## What's new in 1.2

- Documents: plan the outline first (edit, reorder, add sections), each section written on its own; rewrite / expand /
  shorten / simplify any section; add sections later; AI diagrams (flowchart, mind map, sequence, timeline, pie,
  quadrant — drawn offline with Mermaid, brand colours) and AI infographics per section or for the whole document;
  three designs (Modern, Classic, Bold) for PDF, Word and web page.
- Discover on TikTok and Instagram (search, hashtags, profiles; optional sign-in for more results), more ranking modes,
  export results (CSV, HTML, Markdown, text). Link extractor reads Google / Bing / DuckDuckGo search results.
- Reports save as TXT, Markdown, Word, PDF, web page or a narrated video; captions for clips; Export knowledge for
  ChatGPT, Claude, Gemini, NotebookLM or coding agents, with chats, an AI overview and "only what's new".
- Voice: offline voices and cloning, AI style enhance / auto / writer and saved styles, saved voice descriptions,
  waveform editor (select, play, keep, cut), Studio line move / cut / download / restyle and "Translate & recast".
- Engines: update + revert, model catalogue, Hugging Face links, Private mode, Unlimited (fair use) plans, Mac build.

## Build the Windows installer

Requirements: Node 20+. Easiest on Windows. On Linux/macOS the NSIS step also needs Wine with 32-bit support
(Ubuntu: `dpkg --add-architecture i386 && apt install wine64 wine32:i386`).

```bash
npm install
# 1. point the app at your licence server (the WordPress site running the plugin)
#    edit config/app.json → "serverUrl": "https://your-site.com"
npm run dist:win
# → release/Vid-Vision-Setup-<version>.exe
```

The installed app also reads `resources/app-config.json` in its install folder, so the server address can be changed
without rebuilding. Users can also set it on the login screen under **Connection**.

Bump `version` in package.json for every release and set **Latest version** + **Windows installer URL** in the plugin
settings; the app offers the update on launch (or forces it if you set **Minimum version**).

## Build the Mac app

Apple only allows Mac apps to be built and signed on a Mac. Two ways:

1. **GitHub (no Mac needed):** push this folder to a private GitHub repository and run the **Build apps** workflow
   (`.github/workflows/build.yml`, Actions tab → Build apps → Run workflow). It builds the Windows installer and the
   Mac app for Apple silicon and Intel (`.dmg` + `.zip`) and attaches them to the run. Add the signing secrets listed at
   the top of the workflow file to get a signed, notarised app (needs an Apple Developer account, $99/year); without
   them the app still builds but macOS asks people to right-click → Open the first time.
2. **On a Mac:** `npm install`, set `config/app.json`, then `npm run dist:mac` → `release/Vid-Vision-<version>-arm64.dmg`
   and `-x64.dmg`.

On a Mac, offline Whisper comes from Homebrew (`brew install whisper-cpp`); the app tells people this when they pick it.
The NVIDIA engine is Windows-only. Everything else works the same.

## Project layout

- `src/main/` — Electron main process: licence client, built-in AI client (`cloud.js`), IPC + job system, media (ffmpeg), downloads (yt-dlp), transcription,
  LLM/vision providers, TTS engines, images, WordPress publishing, documents, translation, libraries, and the three modules.
- `src/renderer/` — UI (Preact + htm, bundled by esbuild), `engine.html/js` = hidden local-AI window (Kokoro, NLLB).
- `src/shared/` — catalogues (markets, ranking modes, lenses, doc types, layouts, voice styles, 83 prompts, NLLB languages).
- `resources/` — Windows ffmpeg/ffprobe (fetched by `scripts/fetch-win-bins.js`), caption fonts (Poppins/DejaVu, OFL/free).
- `vendor/engine/` — Kokoro web bundle, transformers.js 3.5.1 web build and the matching ONNX Runtime wasm.

Downloaded on first use (kept small installer): yt-dlp, whisper.cpp + models, Piper + voices, Kokoro and NLLB models, Ollama.
