# Vaani AI

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?logo=node.js&logoColor=white)](dashboard/package.json)

**Production AI voice agents from roughly ₹1 per minute for the AI layer.** Self-hosted, multi-tenant voice platform with a premium console, real telephony, and swappable STT, LLM, and TTS providers.

**Repository:** [github.com/IrfanCodesBTW/Vaani-AI](https://github.com/IrfanCodesBTW/Vaani-AI)

---

## Clone

```sh
git clone https://github.com/IrfanCodesBTW/Vaani-AI.git
cd Vaani-AI
cp .env.example .env
```

---
## Quick start

### Local (Docker + dashboard)

Best for development and demos on your machine.

```powershell
cp .env.example .env          # fill in provider keys
powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1
```

Open **[http://localhost:8787](http://localhost:8787)** for the console. Dograh API runs on **[http://localhost:8000](http://localhost:8000)**.

After Docker restarts, refresh the Cloudflare tunnel URL:

```sh
node scripts/bootstrap-dograh-local.mjs
```



### VPS (production telephony)

Bare Ubuntu 24.04 to a ringing phone in six scripted steps.

```sh
git clone https://github.com/IrfanCodesBTW/Vaani-AI.git
cd Vaani-AI
cp .env.example .env
bash deploy/01-deploy-dograh.sh
```

Paste `[ONE-SHOT-PROMPT.md](ONE-SHOT-PROMPT.md)` into an AI coding agent for a guided end-to-end setup.

### Dashboard only

```sh
cd dashboard
cp .env.example .env
sh setup.sh
pnpm install && pnpm build   # compiles the analytics charts bundle
node server.js               # http://localhost:8787
```

Create the first account via **Sign up**. No shared default password is shipped.

---



## The stack


| Layer              | Default                                       | Role                                                                  |
| ------------------ | --------------------------------------------- | --------------------------------------------------------------------- |
| **Orchestrator**   | [Dograh](https://github.com/dograh-hq/dograh) | Workflow graph, VAD, turn detection, recordings, WebRTC and telephony |
| **Telephony**      | VoiceLink (primary), VoBiz via Dograh         | Inbound and guarded outbound calls                                    |
| **Speech-to-text** | Deepgram Nova-3                               | Multilingual, phone-grade latency                                     |
| **Brain**          | Groq / Gemini                                 | Low-latency reasoning                                                 |
| **Voice**          | Sarvam / Rumik silk                           | Cost-efficient TTS; Sarvam recommended for production                 |
| **Console**        | Vaani AI (`dashboard/`)                       | Agents, studio, talk-to-it, telephony, billing, agency tools          |


Every layer is swappable through adapter registries. `GET /api/providers` reports what is live versus configured, never placeholder vendors as ready.

---



## What you get

- **Real phone agents** that greet, listen, barge-in, and place outbound calls with explicit confirm.
- **Browser voice** via Dograh SmallWebRTC using the same published workflow as telephony.
- **Agent builder** with persona, greeting, voice pipeline, and Dograh workflow sync.
- **Voice Studio** with live TTS preview, character metering, and INR cost readout.
- **Call transcripts** synced from Dograh workflow runs.
- **Agency OS** with clients, invoices, integrations setup, wallets, PayU checkout, roles, and audit history.
- **Workflow library** under `workflows/` (Ria receptionist, Vaapas recovery, demos).

---



## Repository layout

```
Vaani-AI/
├── dashboard/           Vaani AI console (Node API + static SPA)
├── deploy/              VPS deployment scripts
├── scripts/             Local Docker bootstrap and helpers
├── workflows/           Importable Dograh workflow graphs
├── prompts/             Full persona prompt stacks
├── docs/                Troubleshooting, pricing, overlay notes
├── ONE-SHOT-PROMPT.md   Agent-ready setup instructions
└── .env.example         Stack-wide environment template
```

---



## Economics

Rumik silk and Sarvam TTS land normal agent replies near **₹1** for the AI layer versus roughly **₹20** on premium Western stacks. Usage is metered per tenant (characters, calls, LLM tokens) and shown in INR in the console. Carrier minutes and VPS cost are separate; see `[docs/PRICING.md](docs/PRICING.md)`.

---



## Security

- Provider keys live in `.env` (gitignored). **Never sent to the browser.**
- Passwords: `scrypt` with per-user salt.
- Sessions: opaque `vaani_sess` httpOnly cookie, 7-day expiry.
- Strict tenant isolation on every API read and write.
- Outbound dials require `confirm: true`.

See `[SECURITY.md](SECURITY.md)` and `[THREAT-MODEL.md](THREAT-MODEL.md)`.

---



## Requirements

- **Node** 18+ for the dashboard
- **Docker** for local Dograh (optional on VPS deploy path)
- API keys: Deepgram, Groq or Gemini, Sarvam or Rumik, telephony via Dograh
- VPS: Ubuntu 24.04, 4 GB RAM recommended, ports 22/80/443 (+ TURN ports for WebRTC)

---



## Documentation


| Doc                                                  | Purpose                                   |
| ---------------------------------------------------- | ----------------------------------------- |
| `[dashboard/README.md](dashboard/README.md)`         | Console features, providers, API overview |
| `[dashboard/SPEC.md](dashboard/SPEC.md)`             | Build contract for contributors           |
| `[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)` | Real failures and fixes                   |
| `[scripts/README.md](scripts/README.md)`             | Local-only helper scripts                 |


---



## License

MIT. See `[LICENSE](LICENSE)`. Dograh is separately licensed by its authors.