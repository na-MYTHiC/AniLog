#!/usr/bin/env bash
# Generate a VAPID keypair for Web Push.
#
#   bash tools/gen-vapid.sh
#
# Uses only OpenSSL, which ships with Git Bash — no Node required. The usual
# `npx web-push generate-vapid-keys` needs a Node install this machine
# doesn't have.
#
# VAPID wants both halves of a P-256 keypair as unpadded base64url:
#   public  — the 65-byte uncompressed point (0x04 || X || Y), 87 chars
#   private — the raw 32-byte scalar,                          43 chars
#
# The byte offsets below come from the SEC1 DER layout, which for P-256 is
# fixed at:  30 77 02 01 01 04 20 <32-byte scalar> ...
# so the scalar always starts at offset 7. Verified with `openssl asn1parse`.
set -euo pipefail

PEM="$(mktemp)"
trap 'rm -f "$PEM"' EXIT

openssl ecparam -name prime256v1 -genkey -noout -out "$PEM" 2>/dev/null

b64url() { base64 -w0 2>/dev/null || base64; }   # -w0 is GNU-only

PUB=$(openssl ec -in "$PEM" -pubout -outform DER 2>/dev/null \
      | tail -c 65 | b64url | tr '+/' '-_' | tr -d '=\n')
PRIV=$(openssl ec -in "$PEM" -outform DER 2>/dev/null \
       | tail -c +8 | head -c 32 | b64url | tr '+/' '-_' | tr -d '=\n')

if [ "${#PUB}" -ne 87 ] || [ "${#PRIV}" -ne 43 ]; then
  echo "Unexpected key length (public ${#PUB}, expected 87; private ${#PRIV}, expected 43)." >&2
  echo "Not writing anything — please report this rather than using these keys." >&2
  exit 1
fi

cat <<EOF

  VAPID keypair
  ─────────────────────────────────────────────────────────────────

  PUBLIC KEY  — not secret, it ships inside the app.
                Put this in scripts/config.js as VAPID_PUBLIC_KEY.

$PUB

  PRIVATE KEY — secret. Anyone holding it can send you notifications.
                Add it as a GitHub Actions secret named VAPID_PRIVATE_KEY:
                Settings → Secrets and variables → Actions → New secret.
                Do not commit it.

$PRIV

  ─────────────────────────────────────────────────────────────────
  This keypair is generated locally and never leaves your machine.
  Regenerating it invalidates every existing subscription — everyone
  would need to tap "Enable notifications" again.

EOF
