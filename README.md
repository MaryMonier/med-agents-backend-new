# Med Agents – Backend API

Backend service for the Med Agents platform: a medical assistant system for doctors that
manages patients, consultations, prescriptions, follow-ups, subscriptions/payments, and a set
of AI-powered agents (medical Q&A, drug safety checks, report generation, follow-up assistant).

Built with **Node.js**, **Express 5**, and **MongoDB (Mongoose)**.

## Tech Stack

- **Runtime:** Node.js + Express 5
- **Database:** MongoDB via Mongoose
- **Auth:** JWT (`jsonwebtoken`) + `bcryptjs` for password hashing
- **AI providers:** OpenAI, Groq, Google Gemini (`@google/genai`)
- **Vector search:** Pinecone (`@pinecone-database/pinecone`) + `@xenova/transformers` for embeddings
- **Payments:** Paymob (with HMAC webhook verification)
- **Security middleware:** `helmet`, `cors`, `express-rate-limit`
- **Scheduled jobs:** `node-cron`

## Project Structure

```
src/
├── controllers/     # Route handlers (auth, patients, consultations, prescriptions, ...)
├── routes/          # Express routers, mounted in app.js
├── middleware/       # authMiddleware, adminMiddleware, checkSubscription, rate limiting
├── models/           # Mongoose schemas (User, Patient, Consultation, Prescription, Payment, ...)
├── services/          # Third-party integrations (Paymob, AI providers, embeddings)
├── config/            # Environment/config helpers, plan definitions
└── app.js             # Express app setup
server.js               # Entry point
```

## Getting Started

### Prerequisites

- Node.js 18+
- A MongoDB instance (local or Atlas)
- API keys for the AI/payment providers you intend to use (see below)

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root (never commit this file). Required variables:

| Variable | Description |
|---|---|
| `PORT` | Port the server listens on |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used to sign JWTs — use a long, random value |
| `ADMIN_SECRET_KEY` | Secret required to create an admin account — use a long, random value |
| `OPENAI_API_KEY` | OpenAI API key (used by the medical AI agents) |
| `GROQ_API_KEY` | Groq API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `PINECONE_API_KEY` | Pinecone API key (vector search) |
| `PINECONE_INDEX` | Pinecone index name |
| `PAYMOB_SECRET_KEY` | Paymob secret key |
| `PAYMOB_PUBLIC_KEY` | Paymob public key |
| `PAYMOB_INTEGRATION_ID` | Paymob integration ID |
| `PAYMOB_HMAC_SECRET` | Paymob HMAC secret, used to verify webhook signatures |
| `FRONTEND_URL` | Allowed origin for CORS |
| `BACKEND_URL` | Public backend URL (used to build Paymob webhook/notification URLs) |

> ⚠️ **Never commit your `.env` file or share it outside the team.** If any of these values are
> ever exposed (pushed to a public repo, shared in a chat, etc.), rotate them immediately from
> the corresponding provider dashboard.

### Running

```bash
# Development (auto-restart with nodemon)
npm run dev

# Production
npm start
```

## Main Features / Modules

- **Auth** — register/login, JWT issuance, admin account creation (protected by `ADMIN_SECRET_KEY`)
- **Patients** — CRUD, patient history
- **Consultations** — create/update/list consultations per doctor/patient
- **Prescriptions** — generate and manage prescriptions linked to consultations
- **Follow-ups** — scheduled follow-up tracking, AI-assisted follow-up agent
- **Drug Safety** — AI-powered drug interaction / safety checks
- **Report Generation** — AI-generated medical reports
- **Subscriptions & Payments** — trial/active/expired subscription states, Paymob integration with webhook HMAC verification
- **Dashboard** — aggregated stats for the admin dashboard

## Access Control

- `authMiddleware` — validates the JWT and attaches `req.user`
- `adminMiddleware` — restricts routes to `role === 'admin'`
- `checkSubscription` — blocks access to core clinical routes when the doctor's subscription
  is not `trial` (unexpired) or `active`, returning a `SUBSCRIPTION_EXPIRED` error code

## Known Issues / TODO

- Audit ownership checks on all consultation/prescription endpoints (some list/delete endpoints
  currently lack a doctor-ownership check — see internal review notes).
- Restrict CORS to `FRONTEND_URL` instead of allowing all origins.
- Whitelist updatable fields on patient/consultation update endpoints instead of passing the
  raw request body to `findByIdAndUpdate`.

## License

Internal project — license TBD.
