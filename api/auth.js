// api/auth.js — Verifica el código del reventa contra Google Sheets
// Hoja "Reventas": columnas A=codigo, B=nombre, C=activo (SI/NO)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const code = (req.query.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ ok: false, error: "Sin código" });

  const SHEET_ID  = process.env.SHEET_ID;
  const API_KEY   = process.env.GOOGLE_API_KEY;
  const RANGE     = "Reventas!A2:C100";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;

  try {
    const r    = await fetch(url);
    const data = await r.json();
    const rows = data.values || [];
    const row  = rows.find(r => (r[0] || "").trim().toUpperCase() === code && (r[2] || "").toUpperCase() === "SI");

    if (row) {
      return res.status(200).json({
        ok: true,
        user: { codigo: row[0].trim().toUpperCase(), nombre: row[1] || "Reventa" }
      });
    }
    return res.status(200).json({ ok: false });
  } catch (e) {
    console.error("auth error:", e);
    return res.status(500).json({ ok: false, error: "Error de servidor" });
  }
}
