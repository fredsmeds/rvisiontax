# R Vision Tax LLC — Marketing & Client Onboarding Platform

> **Live Site:** [rvisiontax.com](https://rvisiontax.com)

A full-stack web platform built for **R Vision Tax LLC**, a Chicago-based tax preparation firm specializing in self-employed individuals, freelancers, and small business owners. The project covers everything from the public-facing marketing site to a bilingual client intake system with automated PDF generation and email delivery — all deployed on the edge with zero servers.

---

## Screenshots

| Landing Page | Onboarding Form | Generated PDF |
|---|---|---|
| Dark, cinematic hero with video background | Multi-step bilingual intake form | Branded PDF with masked sensitive data |

---

## Features

- **Cinematic landing page** — Full-screen video hero, animated splash screen, scroll-triggered sections, and FAQ accordion
- **Bilingual UI (EN/ES)** — Full English/Spanish toggle with zero page reload; all UI strings, form labels, emails, and PDFs switch language dynamically
- **Multi-step intake form** — Progressive disclosure form with dynamic dependent/expense rows, file uploads, and real-time validation
- **Digital signature capture** — Taxpayer and spouse e-signatures drawn on canvas (Signature Pad), embedded directly into the generated PDF
- **Serverless PDF generation** — Cloudflare Browser Rendering API converts a branded HTML template (with form data) into a print-quality letter-format PDF on the fly
- **Automated email delivery** — Resend API sends admin notifications and bilingual client confirmations with the PDF attached
- **Optional KV persistence** — Submissions stored in Cloudflare KV with 1-year TTL; SSN and account numbers masked before storage
- **Legal pages** — Bilingual Privacy Policy and Terms & Conditions covering IRS 7-year retention, Illinois jurisdiction, e-signature validity, and fixed-fee pricing terms

---

## Tech Stack

### Frontend
| Technology | Usage |
|---|---|
| **HTML5** | Semantic markup, `data-lang` i18n attributes, multi-page architecture |
| **CSS3** | Custom properties (design tokens), Grid, Flexbox, `clamp()` fluid type, `backdrop-filter`, keyframe animations |
| **Vanilla JavaScript (ES6+)** | DOM manipulation, Intersection Observer, language switcher, multi-step form logic, accordion, form validation |
| **Signature Pad 4.1.7** | Canvas-based e-signature capture for taxpayer and spouse |
| **WebP / WebM** | Optimized images and video backgrounds for performance |
| **Custom Fonts** | Rinter (display) + SpartanMB Bold (body) via `@font-face` with `font-display: swap` |

### Backend / Infrastructure
| Technology | Usage |
|---|---|
| **Cloudflare Workers** | Serverless edge API — zero cold starts, global distribution |
| **Cloudflare Browser Rendering API** | Server-side HTML → PDF conversion with full CSS support |
| **Cloudflare KV** | Optional edge key-value storage for form submissions |
| **Resend API** | Transactional email delivery — HTML + plain text + PDF attachments |
| **Wrangler CLI** | Local dev, secrets management, staged deploys (dev / staging / production) |

### Design System
| Token | Value |
|---|---|
| **Primary** | `#3000ff` (R Vision Blue) |
| **Background** | `#000000` |
| **Surface** | `#1a1a1a` / `#111111` |
| **Text** | `#ffffff` / `#f5f5f5` |
| **Success** | `#00cc66` |
| **Error** | `#ff3333` |
| **Transition (smooth)** | `cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.4s` |
| **Spacing scale** | `0.5rem` → `5rem` (xs through xxl) |
| **Type scale** | `clamp(2.5rem, 6vw, 4.5rem)` → `clamp(0.95rem, 2vw, 1.1rem)` |

---

## Project Structure

```
rvision_web/
├── index.html          # Landing page (splash, hero, about, FAQ, contact)
├── onboarding.html     # Multi-step client intake form
├── privacy.html        # Bilingual Privacy Policy
├── terms.html          # Bilingual Terms & Conditions
├── css/
│   └── style.css       # Full design system + component styles
├── fonts/
│   ├── Rinter.ttf
│   └── SpartanMB-Bold.ttf
├── images/             # Logos (WebP), favicon, background images
├── worker/
│   ├── index.js        # Cloudflare Worker — API routes, PDF & email logic
│   ├── wrangler.toml   # Worker config (routes, KV bindings, environment)
│   └── package.json
```

---

## Worker API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/contact` | Contact form — validates fields, emails admin + sends bilingual client confirmation |
| `POST` | `/api/onboarding` | Intake form — generates branded PDF, emails admin with attachment, confirms to client |
| `GET` | `/api/health` | Health check |

### Environment Secrets (Wrangler)
```
RESEND_API_KEY       # Resend transactional email API key
RECIPIENT_EMAIL      # Admin notification recipient
FROM_EMAIL           # Sending address (e.g. noreply@rvisiontax.com)
CF_ACCOUNT_ID        # Cloudflare account (Browser Rendering API)
CF_API_TOKEN         # Cloudflare API token (Browser Rendering API)
SUBMISSIONS_KV       # KV namespace binding (optional)
```

---

## Key Engineering Decisions

- **No build step** — Pure HTML/CSS/JS; zero bundlers, zero dependencies on the frontend. Fast to load, easy to maintain.
- **Edge-native backend** — Cloudflare Workers run at 300+ PoPs globally. No origin server, no infrastructure to manage.
- **PDF from HTML** — Using Browser Rendering instead of a PDF library means the intake document is fully styled with brand colors, tables, and embedded signature images — and trivially maintainable as HTML.
- **Bilingual at the data layer** — Language isn't just CSS class toggling; form submissions, email templates, and generated PDFs all respect the user's selected language (`en`/`es`).
- **Privacy-first data handling** — SSNs are masked (`XXX-XX-####`) before KV storage; full numbers only appear in the PDF transmitted directly to the client. Account numbers are similarly truncated.

---

## Local Development

```bash
# Worker dev server
cd worker
npm install
npx wrangler dev
```

For the frontend, serve the root directory with any static file server (e.g. VS Code Live Server or `npx serve .`).

---

## About the Developer

This project was designed and built end-to-end — UI/UX design, frontend development, serverless backend, email infrastructure, and legal page authoring. It demonstrates proficiency in:

- **Modern CSS** without frameworks (design systems, animations, responsive layout)
- **Vanilla JS** architecture for complex interactive UIs
- **Serverless / edge computing** with Cloudflare's developer platform
- **API integrations** (Resend, Cloudflare Browser Rendering)
- **Bilingual product design** for English/Spanish audiences
- **Full-cycle delivery** from brand identity to production deployment

---

*Built with HTML, CSS, JavaScript, and Cloudflare Workers. No frameworks. No unnecessary dependencies.*
