// api/usados.js — Lee los iPhones usados desde Google Sheets
// Hoja "Usados": A=codigo, B=modelo, C=capacidad, D=bateria, E=color,
//                F=estado_stock, G=caja, H=garantia, I=precio_usd,
//                J=precio_ars_efec, K=precio_ars_transf, L=estado (Excelente/Muy bueno/etc)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=120");

  const SHEET_ID = process.env.SHEET_ID;
  const API_KEY  = process.env.GOOGLE_API_KEY;
  const RANGE    = "Usados!A2:M300";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;

  try {
    const r    = await fetch(url);
    const data = await r.json();
    const rows = data.values || [];

    const items = rows
      .filter(r => r[0] && r[1])
      .map(r => ({
        codigo:           r[0] || "",
        modelo:           r[1] || "",
        capacidad:        r[2] || "",
        bateria:          r[3] || "",
        color:            r[4] || "",
        estado_stock:     r[5] || "",
        caja:             r[6] || "",
        garantia:         r[7] || "",
        precio_usd:       parseFloat(r[8])  || 0,
        precio_ars_efec:  parseFloat((r[9]  || "0").replace(/\./g,"").replace(",","."))  || 0,
        precio_ars_transf:parseFloat((r[10] || "0").replace(/\./g,"").replace(",",".")) || 0,
        estado:           r[11] || "Excelente",
        imagen:           r[12] || "",
      }));

    return res.status(200).json({ items });
  } catch(e) {
    console.error("usados error:", e);
    return res.status(500).json({ items: [], error: "Error al leer usados" });
  }
}
