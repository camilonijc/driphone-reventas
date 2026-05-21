// api/add-movimiento.js — Agrega un movimiento a la hoja CC_Reventas
// Requiere GOOGLE_SERVICE_ACCOUNT_KEY (JSON) o usar el método de OAuth
// Versión simplificada: usa Google Sheets API con Service Account

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const { codigo, fecha, concepto, tipo, tipo_flujo, monto_usd } = req.body;
  if (!codigo || !fecha || !concepto || !tipo || !tipo_flujo || !monto_usd) {
    return res.status(400).json({ ok: false, error: "Faltan campos" });
  }

  const SHEET_ID    = process.env.SHEET_ID;
  const SA_KEY_JSON = process.env.GOOGLE_SA_KEY; // Service Account JSON

  try {
    // Parse service account key
    const sa = JSON.parse(SA_KEY_JSON);

    // Get access token via JWT
    const token = await getAccessToken(sa);

    // Append row to CC_Reventas
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/CC_Reventas!A:F:append?valueInputOption=USER_ENTERED`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: [[codigo, fecha, concepto, tipo, tipo_flujo, monto_usd]]
      })
    });

    if (r.ok) {
      return res.status(200).json({ ok: true });
    } else {
      const err = await r.text();
      console.error("sheets append error:", err);
      return res.status(500).json({ ok: false, error: err });
    }
  } catch(e) {
    console.error("add-movimiento error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// Genera un JWT y lo intercambia por un access token de Google
async function getAccessToken(sa) {
  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  // Encode JWT
  const header  = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claim));
  const unsigned = `${header}.${payload}`;

  // Sign with RSA private key
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64url(sig)}`;

  // Exchange JWT for access token
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await resp.json();
  return data.access_token;
}

function base64url(data) {
  let str;
  if (typeof data === "string") {
    str = btoa(unescape(encodeURIComponent(data)));
  } else {
    str = btoa(String.fromCharCode(...new Uint8Array(data)));
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8", der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
}
