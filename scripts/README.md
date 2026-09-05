# scripts/

Local Docker only. VPS deploy uses `deploy/`.

| Script | Purpose |
|---|---|
| `start_local.ps1` | One-command local Docker deployment: builds Rumik overlay, starts Dograh with Cloudflare tunnel, and launches the dashboard on `:8787`. Run `powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1`. |
| `bootstrap-dograh-local.mjs` | Bootstraps a fresh local Dograh stack (signup, model pipeline, VoiceLink + VoBiz telephony, VaapasAI workflow, API key and embed token) and syncs `../.env` + `../dashboard/.env`. |
| `switch-tts-sarvam.mjs` | Switches the local model pipeline between Rumik and Sarvam TTS. |
| `preflight-smoke.js` | Preflight smoke checks for the local stack. |

All scripts are idempotent and safe to re-run. Secrets stay in `.env` (gitignored) — no keys are committed.

Root wrapper: `start_local.ps1` at repo root delegates to `scripts/start_local.ps1` for backward compatibility.
