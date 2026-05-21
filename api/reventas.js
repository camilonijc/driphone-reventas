// api/reventas.js — Devuelve la lista de reventas activos
// Hoja "Reventas": A=codigo, B=nombre, C=activo (SI/NO)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const SHEET_ID = process.env.SHEET_ID;
  const API_KEY  = process.env.GOOGLE_API_KEY;
  const RANGE    = "Reventas!A2:C100";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;

  try {
    const r    = await fetch(url);
    const data = await r.json();
    const rows = data.values || [];

    const reventas = rows
      .filter(r => r[0] && (r[2] || "").toUpperCase() === "SI")
      .map(r => ({
        codigo: r[0].trim().toUpperCase(),
        nombre: r[1] || r[0],
      }));

    return res.status(200).json({ reventas });
  } catch(e) {
    console.error("reventas error:", e);
    return res.status(500).json({ reventas: [], error: "Error al leer reventas" });
  }
}
