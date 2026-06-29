# Canonical ingest contract

The single versioned schema every client targets. Normalize to **UTC + °C** at the edge.

Reading (one row):
```json
{
  "device_id": "shelly-ht-3c61",
  "api_key": "donor-scoped-secret",
  "readings": [
    { "ts": "2026-06-28T12:00:00Z",
      "temp_c": 27.4,
      "temp_c_min": 27.1,
      "temp_c_max": 30.4,
      "rh_pct": 52.0,
      "room_ref": "schlafzimmer" }
  ]
}
```

Rules: batch arrays, idempotent on `(device_id, ts)`, accept JSON and form-encoded
(Ecowitt) at the edge, version the path (`/v1/ingest`) and keep it backward-compatible —
integrations in the wild update on their own schedule.
