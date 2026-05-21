// api/cc.js — Lee la cuenta corriente del reventa desde Google Sheets
// Hoja "CC_Reventas": A=codigo, B=fecha, C=concepto, D=tipo(venta/pago/credito/ajuste),
//                     E=tipo_flujo(debe/haber), F=monto_usd

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const codigo = (req.query.codigo || "").trim().toUpperCase();
  if (!codigo) return res.status(400).json({ error: "Sin código" });

  const SHEET_ID = process.env.SHEET_ID;
  const API_KEY  = process.env.GOOGLE_API_KEY;
  const RANGE    = "CC_Reventas!A2:F500";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;

  try {
    const r    = await fetch(url);
    const data = await r.json();
    const rows = data.values || [];

    const movimientos = rows
      .filter(r => (r[0] || "").trim().toUpperCase() === codigo && r[1])
      .map(r => ({
        codigo:     r[0],
        fecha:      r[1],
        concepto:   r[2] || "",
        tipo:       r[3] || "ajuste",
        tipo_flujo: r[4] || "debe",
        monto_usd:  parseFloat(r[5]) || 0,
      }));

    const saldo = movimientos.reduce((acc, m) => {
      return m.tipo_flujo === "haber" ? acc + m.monto_usd : acc - m.monto_usd;
    }, 0);

    return res.status(200).json({
      codigo,
      saldo: Math.round(saldo * 100) / 100,
      movimientos,
    });
  } catch (e) {
    console.error("cc error:", e);
    return res.status(500).json({ saldo: 0, movimientos: [], error: "Error al leer cuenta" });
  }
}
