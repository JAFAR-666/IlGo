# Verbix

A React + Node app for AI-powered communication practice focused on:

- Group discussions (GDs)
- Public speaking
- Presentations

Verbix gives you a React frontend, a lightweight Node backend, optional OpenAI-powered coaching, Postgres-backed auth and saved practice history, browser voice practice with speaking analysis, and a realtime AI voice studio.
This version is prepared for Railway + Postgres deployment, adds analytics charts, and scores live transcript turns during realtime voice sessions.

## What this MVP does

- Branded landing page and authentication flow
- Lets a learner pick a practice mode
- Saves completed practice sessions for logged-in users
- Generates a guided scenario and coaching objective
- Accepts typed responses and browser-recorded voice practice
- Tracks transcript length, speaking pace, and filler-word signals
- Evaluates the response on clarity, structure, filler-word usage, confidence signals, and actionability
- Returns feedback, strengths, gaps, and a follow-up coaching prompt
- Opens a realtime AI voice conversation mode through OpenAI Realtime

## Why this structure

The product is split into two layers:

1. `client/`
   The React learner experience
2. `server.js` + `src/coach.js` + `src/openaiCoach.js`
   The API and coaching engine

That separation makes it easy to upgrade the coaching engine later to use:

- OpenAI Realtime for mock interviews / speaking drills
- Speech-to-text for live speaking practice
- Text-to-speech for panel simulation
- Session memory and learner progress tracking

## Run locally

```bash
npm install
npm run build
node server.js
```

Then open [http://localhost:3000](http://localhost:3000)

## Run in development

Use two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Then open [http://localhost:5173](http://localhost:5173)

## Enable OpenAI evaluation

This app now supports two evaluation modes:

- `heuristic`
  default fallback with no API key needed
- `openai`
  model-based coaching via the OpenAI Responses API

Create a `.env`-style environment in your shell before starting the server:

```bash
$env:OPENAI_API_KEY="your_key_here"
$env:OPENAI_MODEL="gpt-5-mini"
node server.js
```

If `OPENAI_API_KEY` is not set, the app stays fully usable and falls back to the built-in evaluator.

## Realtime voice mode

Verbix also includes a Voice Studio that connects the browser to OpenAI Realtime through your server.

- It requires `OPENAI_API_KEY`
- It uses the `OPENAI_REALTIME_MODEL` environment variable when set
- Live transcript turns are scored through the same coaching engine and saved into analytics history
- Browser support depends on microphone and WebRTC availability

## Database

Verbix stores users, auth sessions, practice sessions, and practice turns in Postgres.

- `DATABASE_URL` is required
- Railway Postgres provides `DATABASE_URL` automatically
- Auth uses opaque session tokens stored as hashed database sessions with expiry
- The app runs startup schema creation automatically

## Railway deployment

Recommended production target: Railway with a Postgres service attached.

1. Push this project to GitHub
2. Create a new Railway project from the repo
3. Add a PostgreSQL service
4. Ensure these env vars are set:
   - `DATABASE_URL`
   - `AUTH_SECRET`
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
   - `OPENAI_REALTIME_MODEL`
5. Railway will run `npm start`
6. Health check path: `/api/health`

## OpenAI integration notes

The server calls `POST https://api.openai.com/v1/responses` and requests structured JSON output for:

- category scores
- strengths
- improvement areas
- summary feedback
- next-round coaching prompt

This follows OpenAI's current recommendation to use the Responses API for new text-generation projects and uses a structured JSON schema for reliable parsing.

## Suggested next upgrades

- Add role-play personas for GD moderators, interviewers, or presentation audiences
- Persist learner history and track improvement trends
- Add rubric customization by target use case:
  - placement GD
  - executive communication
  - classroom presentations
  - sales pitches
- Add realtime voice coaching with OpenAI Realtime
- Add answer rewrites, exemplar responses, and rubric-specific scoring

## Core product idea

The agent should behave like a supportive communication trainer:

- before practice: set context, goal, and rubric
- during practice: prompt, challenge, and guide
- after practice: diagnose issues and prescribe drills

## Current limitations

- Browser speech recognition availability varies by browser
- Authentication and history use simple local JSON files, not a production database
- OpenAI coaching requires an API key and internet access
- Realtime voice also depends on available OpenAI quota
- Sessions are in-memory only
