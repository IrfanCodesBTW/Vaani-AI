<div align="center">
  <img src="public/assets/logo.svg" alt="Vaani AI" width="300" />
</div>

# Vaani AI Console

**Production AI voice agents at roughly one rupee for the AI layer.** A premium, multi-tenant, provider-agnostic voice agent platform with a swappable STT, LLM, TTS, and telephony stack so you are never locked to one vendor.

Runs from one Node service. The product shell is dependency-free browser JavaScript; the agency analytics island is compiled from React and Recharts into a self-hosted bundle. No CDN runtime is required.

## Quick start

```sh
cp .env.example .env     # fill in your keys
pnpm install             # runtime and build dependencies
pnpm build               # compiles the Recharts analytics island
sh setup.sh              # checks Node, creates data/, prints next steps
node server.js           # http://localhost:8787
```

Open `http://localhost:8787` and sign up or sign in.

For automated QA, set `TEST_USER_EMAIL`, a password of at least 12 characters, and optionally `TEST_USER_SUPER_ADMIN=true` before first boot.

## Provider architecture

| Layer | Implemented | Selection |
| --- | --- | --- |
| **STT** | Deepgram Nova-3 | Fixed to Deepgram by product decision |
| **TTS** | Rumik silk, Sarvam | Tenant pipeline / `TTS_PROVIDER` |
| **LLM** | Groq, Google Gemini | `LLM_PROVIDER`, `LLM_MODEL` |
| **Telephony** | VoiceLink, VoBiz via Dograh | `TELEPHONY_PROVIDER` |

`GET /api/providers` reports only adapters that ship in this repo. Secrets never leave the server.

Dograh's **published workflow** is the authority for browser WebRTC and phone calls. Dashboard `LLM_PROVIDER` and `TTS_PROVIDER` configure `/api/chat` and `/api/tts`; they do not silently rewrite a live Dograh workflow.

## Console features

- **Overview** with provider health, usage KPIs, and quick actions
- **Agency overview** with revenue charts (platform roles)
- **Clients, invoices, integrations, agency prompt** (role-gated)
- **Agents** with persona, voice, greeting, and live preview
- **Voice Studio** with real WAV synthesis and cost readout
- **Talk to it** via Dograh SmallWebRTC
- **Telephony** with carrier status and guarded outbound dial
- **Billing** via PayU (keep `PAYU_ENV=test` until production checklist)
- **Settings** with provider registry and tenant branding

## Security

- Keys in `.env` only; browser talks to `/api/*` proxies
- `scrypt` password hashing, `vaani_sess` httpOnly sessions
- Tenant isolation on every mutation
- XSS: user strings escaped before DOM injection
- Real calls require explicit `confirm: true`

## Production boundary

The bundled JSON store suits local evaluation and single-process deploys. Before accepting customer money or running multiple replicas, move wallets, payments, and audit data to transactional PostgreSQL. See [`SAAS-QA-CHECKLIST.md`](SAAS-QA-CHECKLIST.md).

## Further reading

- [`SPEC.md`](SPEC.md) binding contract
- [`SAAS-API.md`](SAAS-API.md) SaaS endpoints
- [`CLAUDE.md`](CLAUDE.md) contributor orientation

MIT licensed. No em dashes anywhere in this codebase.
