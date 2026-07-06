# TemperaturCrowd API Server

This is the backend server for the TemperaturCrowd project. 

## What it does
It handles:
- **Authentication**: Uses Blind RSA for privacy-preserving authentication.
- **Data Ingestion**: Receives and processes data securely from the Home Assistant integrations.
- **Cohort Metrics**: Computes dynamic cohort metrics for comparison without tracking individual users.

The server code is located in `apps/api/`.

## Setup Instructions

### 1. Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A libSQL / Turso database

### 2. Environment Variables
Create a `.env` file in the **`apps/api/`** directory based on the following template:

```env
# Database (libSQL / Turso)
DATABASE_URL="libsql://<your-turso-url>"
DATABASE_AUTH_TOKEN="<your-turso-token>"

# Seven API (for OTP SMS)
SEVEN_API_KEY="<your-seven-api-key>"

# Cloudflare Turnstile (Captcha)
TURNSTILE_SECRET_KEY="<your-turnstile-secret-key>"

# Security & Privacy Secrets
PHONE_HMAC_SECRET="<generate-a-random-secret-string>"
RSA_PRIVATE_KEY_B64="<generate-using-instructions-below>"
```

### 3. Generating the RSA Private Key
For privacy reasons, the RSA private key is used to blind-sign the authentication tokens. It must be provided as a single-line base64 string via the environment variable.

To generate a new secure 2048-bit key, run from the root:
```bash
pnpm --filter @temperaturcrowd/api run generate-key
```
This will output a base64 string. Copy it exactly as provided into your `apps/api/.env` or Bunny CDN environment variables as `RSA_PRIVATE_KEY_B64`.

### 4. Database Initialization
Once your `.env` is configured, you can initialize the database schema. If you want to wipe the remote database and start fresh, run:
```bash
pnpm --filter @temperaturcrowd/api run reset-db
```
*Warning: This will drop all tables and completely wipe the database.*

The schema will be automatically created on the first server boot.

### 5. Running the Server

**Local Development (from root):**
```bash
pnpm run dev
```

**Production Build (from root):**
```bash
pnpm run build
pnpm run start
```

## Deployment on Bunny CDN (Edge Containers)

Bunny CDN requires single-line environment variables, which is why `RSA_PRIVATE_KEY_B64` is encoded in base64. 
Simply define all the environment variables from your `.env` in the Bunny CDN dashboard for your container edge app. The Dockerfile will automatically build the project and run `pnpm run start`.
