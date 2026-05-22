// api/stock.js — Lee el stock disponible desde Google Sheets
// Hoja "Stock_Web": A=id, B=modelo, C=capacidad, D=color, E=estado,
//                   F=precio_usd, G=cotizacion, H=estado_stock,
//                   I=precio_ars, J=cotizacion_usd,
//                   K=categoria, L=stock_count

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=120");

  const SHEET_ID = process.env.SHEET_ID;
  const API_KEY  = process.env.GOOGLE_API_KEY;
  const RANGE    = "Stock_Web!A2:L300";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;

  try {
    const r    = await fetch(url);
    const data = await r.json();
    const rows = data.values || [];

    const items = rows
      .filter(r => r[7] === "Disponible" && r[0] && r[1])
      .map(r => ({
        id:          r[0],
        modelo:      r[1] || "",
        capacidad:   r[2] || "",
        color:       r[3] || "",
        estado:      r[4] || "Excelente",
        precio_usd:  parseFloat(r[5]) || 0,
        cotizacion:  parseFloat(r[6]) || 1455,
        categoria:   r[10] || "iPhone",
        stock_count: parseInt(r[11]) || 0,
      }));

    return res.status(200).json({ items, updated: new Date().toISOString() });
  } catch (e) {
    console.error("stock error:", e);
    return res.status(500).json({ items: [], error: "Error al leer stock" });
  }
}
