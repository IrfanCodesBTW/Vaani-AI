# Vaani AI — Premium Cream Design Contract

## 1. Product posture

Vaani AI is the operating surface for AI voice operations inside Vaani AI Agency OS. It must feel warm, exact, and premium: a funded SaaS product, not a dark developer console. The product combines client operations, voice agents, telephony, revenue, and integrations without making unavailable connectors appear live.

The primary user is an agency owner or tenant operator who needs to understand agent health, call readiness, and operational risk in under ten seconds.

## 2. Visual direction

- **Premium cream canvas** across every route: boot shell, auth, sidebar, main work area, modals, empty states, and telephony cards.
- **Bronze accent** for primary actions, active nav, and economic proof (₹1 runtime positioning).
- **Serif display + sans body**: headlines and page titles use a refined serif; UI chrome and body copy use a humanist sans stack.
- **No charcoal navigation rail.** Sidebars and proof panels stay on the cream surface system with quiet borders and shallow elevation.
- Recharts is the only chart implementation. Charts load only on routes that mount analytics.

## 3. Tokens

Canonical CSS tokens live in `public/assets/brand.css`.

| Token | Value | Use |
|---|---|---|
| Canvas | `#FBF7EF` | Page background, boot shell |
| Surface | `#FFFDF8` | Cards, panels, inputs at rest |
| Surface raised | `#F5F0E6` | Secondary panels, table headers |
| Ink | `#2A2419` | Primary text |
| Ink soft | `#5C5548` | Secondary text |
| Ink dim | `#7A7264` | Labels, metadata |
| Ink faint | `#A39B8D` | Placeholders, disabled |
| Accent | `#A8743B` | Primary CTA, active nav, links |
| Accent deep | `#7A5228` | Hover, emphasis |
| Accent wash | `rgba(168,116,59,0.12)` | Active backgrounds |
| Line | `rgba(42,36,25,0.10)` | Default borders |
| Line strong | `rgba(42,36,25,0.18)` | Emphasized borders |
| Positive | `#2D7A56` | Connected, paid, live |
| Warning | `#B96B21` | Setup required, degraded |
| Critical | `#A83D4F` | Error, overdue, blocked |
| Informational | `#3D6F8C` | Neutral system notes |

Radii: 10, 14, 18, 24 px. Pills reserved for status and filters.

Shadows are shallow and warm. No neon glows or dark-mode gradients on product chrome.

## 4. Typography

- **Display (serif):** `"Libre Baskerville", "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif`
- **Body (sans):** `"SF Pro Text", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- **Mono:** `"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`

Scale:

- Page titles: 28–34 px, serif, tight tracking
- Section titles: 18–22 px, serif or semibold sans
- KPI values: 28–40 px, tabular numerals
- Labels: 11–13 px, sentence case
- Body: 14–16 px, max line length 68 characters

Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40 px.

## 5. Primitives and states

### Buttons

- Primary: bronze accent fill, cream ink on hover states, minimum 44 px target
- Secondary: cream surface + visible border
- Destructive: critical red, always names the target
- States: default, hover, focus-visible, disabled, loading

### Cards

- One-pixel border, cream surface, optional shallow shadow for hierarchy only
- KPI cards: label, number, one explanatory line
- Integration and telephony cards: truthful state chip (connected, setup required, unavailable, error)

### Tables

- Semantic markup, sticky headers when long, horizontal scroll on small screens
- Empty, loading, and error occupy the same frame so layout does not jump

### Talk to it

- State machine visible in status pill: `idle → requesting_permission → connecting → listening ↔ thinking ↔ speaking → ended`
- Transcript panel shows interim and final `rtf-user-transcription` text
- Diagnostic panel reports connect time, first partial transcript, turn finalize, first response, barge-in stop latency
- Microphone releases on end, error, and route navigation

### Telephony

- Dual-carrier layout uses side-by-side **carrier cards** (VoBiz primary, VoiceLink optional secondary)
- Each card: connection status, numbers, routes, last verification, test action
- Secrets masked; carrier-specific empty and blocked states

## 6. Product surfaces

### Authentication

- Split layout: narrow cream form panel + proof panel on the same canvas system (no charcoal proof slab)
- Proof panel uses subtle grid, live capability chips, and agency metrics
- Proof panel collapses below 960 px; form stays centered

### Console shell

- Cream sidebar with bronze active state, not a dark rail
- Sticky topbar on canvas wash with health chips
- Main work area on canvas `#FBF7EF`

### Voice routes

- **Talk to it:** WebRTC through Dograh; transcript + diagnostics; no legacy record/upload path
- **Telephony:** carrier cards prepared for VoBiz + VoiceLink
- **Voice Studio / Agents:** builder forms on cream cards with bronze focus rings

## 7. Motion, accessibility, and performance

- Animate transform and opacity only
- Disable chart and grid motion under `prefers-reduced-motion`
- Focus order follows visual order; color is never the only status signal
- Target WCAG 2.2 AA contrast on cream surfaces
- Verify at 375, 768, and 1280 px with zero console errors
- React and Recharts load only as a focused analytics island
