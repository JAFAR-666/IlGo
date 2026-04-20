# IlGo

IlGo is a React + Node marketplace MVP for on-demand home services. It now includes:

- Customer booking flow
- Worker dispatch console
- Smart worker matching by distance, rating, and price
- Live tracking over server-sent events
- Payment capture records
- Postgres-backed auth and marketplace data

## Product shape

The app is structured as a single deployable service:

1. `client/`
   The responsive customer and worker web UI
2. `server.js`
   The Node HTTP server and API routes
3. `src/db.js` + `src/ilgoStore.js`
   Postgres schema, seeded services/workers, matching logic, bookings, payments, and tracking updates

## Main user flows

### Customer

- Register or log in
- Choose a service
- Set location coordinates
- Review ranked nearby workers
- Confirm the booking
- Watch the worker move live
- Pay after arrival or completion

### Worker

- Select a seeded worker profile
- Toggle availability
- View assigned jobs
- Accept a request
- Move closer to the customer
- Mark arrived and completed

## Local setup

Create environment variables:

```bash
DATABASE_URL=postgresql://user:password@host:5432/ilgo
AUTH_SECRET=replace_with_a_long_random_secret
PORT=3000
```

Optional OpenAI variables can stay unset for this MVP:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
OPENAI_REALTIME_MODEL=gpt-realtime
```

Install and run:

```bash
npm install
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Development mode

Use two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open [http://localhost:5173](http://localhost:5173)

## API overview

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

### Marketplace

- `GET /api/ilgo/bootstrap`
- `GET /api/ilgo/workers?service=...&latitude=...&longitude=...`
- `POST /api/ilgo/bookings`
- `GET /api/ilgo/bookings`
- `GET /api/ilgo/bookings/:id`
- `POST /api/ilgo/bookings/:id/status`
- `POST /api/ilgo/bookings/:id/pay`
- `GET /api/ilgo/track/:bookingId`

### Worker console

- `GET /api/ilgo/workers/:workerId/jobs`
- `POST /api/ilgo/workers/:workerId/availability`
- `POST /api/ilgo/workers/:workerId/location`

## Smart matching

Workers are ranked using a weighted score that blends:

- Distance from the customer
- Worker rating
- Worker hourly price

Lower score wins the dispatch.

## Live tracking

Tracking uses server-sent events at `GET /api/ilgo/track/:bookingId`.

- Customer screens subscribe to one booking channel
- Worker actions update booking status and coordinates
- Location/status/payment changes are pushed to the browser immediately

This keeps the stack dependency-light while still giving near real-time behavior.

## Google Maps upgrade path

The current UI uses a provider-neutral tracking board so the app works without external keys. To upgrade to Google Maps:

1. Add a browser Maps component in the client
2. Store `VITE_GOOGLE_MAPS_API_KEY`
3. Feed `customerLatitude`, `customerLongitude`, `workerLatitude`, and `workerLongitude` into map markers
4. Subscribe to `/api/ilgo/track/:bookingId` and update those markers live

## Railway deployment

Recommended path:

1. Push the repo to GitHub
2. Create a Railway project
3. Attach a PostgreSQL service
4. Add `DATABASE_URL` and `AUTH_SECRET`
5. Deploy with `npm start`
6. Set health check to `/api/health`

`railway.json` is already configured for the start command and health check.

## Render deployment

1. Create a new Web Service from the repo
2. Provision a Postgres database
3. Set `DATABASE_URL` and `AUTH_SECRET`
4. Build command: `npm install && npm run build`
5. Start command: `npm start`

If you place Render behind a proxy, keep streaming responses enabled for the tracking endpoint.
