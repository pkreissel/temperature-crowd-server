# Bunny Edge Scripts

## IP-Hash-Middleware (`ip-hash-middleware.ts`)

Läuft am Bunny-Edge vor dem Origin-Container. Für jede Anfrage an den Origin wird die echte Besucher-IP (`X-Real-IP` bzw. der erste `X-Forwarded-For`-Eintrag) durch einen gesalzenen SHA-256-Hash im Header `X-Client-IP-Hash` ersetzt und alle Roh-IP-Header werden entfernt. Der Origin sieht so nie eine echte Client-IP.

Der Rate-Limiter des Origins nutzt `X-Client-IP-Hash` als Schlüssel (siehe `apps/api/src/routes/helpers/rateLimit.ts`) — das Limit greift also pro Client, aber auf einem anonymen, nicht rückführbaren Token statt einer IP oder der geteilten Bunny-Edge-IP.

**Deployment:**
1. In Bunny ein Edge Script vom Typ *Middleware* anlegen und der Pull Zone vor dem Container zuweisen.
2. Umgebungsvariable `IP_HASH_SALT` auf ein langes, zufälliges Geheimnis setzen.
3. Ein Rotieren des Salts rotiert alle Hashes (die Rate-Limit-Buckets werden zurückgesetzt) — unkritisch.

---

# Bunny Edge Scripts (English)

## IP hash middleware (`ip-hash-middleware.ts`)

Runs at the Bunny edge in front of the origin container. For every request to the origin it replaces the real visitor IP (`X-Real-IP`, or the first `X-Forwarded-For` hop) with a salted SHA-256 hash in the `X-Client-IP-Hash` header and strips all raw-IP headers. The origin therefore never sees a real client IP.

The origin rate-limiter keys on `X-Client-IP-Hash` (see `apps/api/src/routes/helpers/rateLimit.ts`), so limiting still works per client — on an opaque, unlinkable token rather than an IP or Bunny's shared edge IP.

**Deployment:**
1. Create a Bunny Edge Script of type *Middleware* and attach it to the Pull Zone in front of the container.
2. Set the `IP_HASH_SALT` environment variable to a long random secret.
3. Rotating the salt rotates all hashes (rate-limit buckets reset) — harmless.
