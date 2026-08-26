// api/whatsapp-webhook.js
//
// Webhook de WhatsApp (Meta Cloud API) para Dr.iPhone.
// Recibe mensajes de WhatsApp, busca en la planilla "Stock_Web" (Google Sheets)
// que alimenta www.iphoneneuquen.com, y responde automático con lo que encuentra.
//
// Variables de entorno necesarias en Vercel:
//   WHATSAPP_VERIFY_TOKEN   -> cualquier string que vos elijas (ej: "driphone2026verify")
//                              tiene que coincidir con lo que configures en Meta.
//   WHATSAPP_PHONE_NUMBER_ID -> el Phone Number ID que te dio Meta (ej: 1301007246430643)
//   WHATSAPP_ACCESS_TOKEN    -> el token de acceso (de prueba ahora, permanente más adelante)

const SHEET_ID = '15RW4h1ClJJ0VgR5bBEk13nmAnn_N_Veq8Hq9wiX4poc'
const SHEET_NAME = 'Stock_Web'

export default async function handler(req, res) {
  // --- Verificación del webhook (Meta lo llama una sola vez al configurar) ---
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge)
    }
    return res.status(403).send('Forbidden')
  }

  // --- Mensajes entrantes ---
  if (req.method === 'POST') {
    try {
      const body = req.body
      const entry = body.entry?.[0]
      const change = entry?.changes?.[0]
      const value = change?.value
      const mensaje = value?.messages?.[0]

      // Solo procesamos mensajes de texto (por ahora)
      if (mensaje && mensaje.type === 'text') {
        const de = mensaje.from
        const texto = mensaje.text.body

        const respuesta = await buscarStockYResponder(texto)
        await enviarMensajeWhatsApp(de, respuesta)
      }

      // Meta espera un 200 rápido, siempre — si tarda o falla, reintenta el webhook
      return res.status(200).send('EVENT_RECEIVED')
    } catch (err) {
      console.error('Error procesando mensaje de WhatsApp:', err)
      return res.status(200).send('EVENT_RECEIVED')
    }
  }

  return res.status(405).send('Method not allowed')
}

// Busca en la planilla de stock según lo que escribió el cliente, y arma la respuesta.
async function buscarStockYResponder(textoCliente) {
  const filas = await leerPlanillaStock()

  const consulta = normalizar(textoCliente)
  const palabrasConsulta = consulta.split(/\s+/).filter(p => p.length > 1)

  const coincidencias = filas.filter(fila => {
    const textoFila = normalizar(`${fila.modelo} ${fila.capacidad} ${fila.color} ${fila.categoria}`)
    // Coincide si al menos 2 palabras de la consulta aparecen en la fila (o 1 si solo escribió una)
    const matches = palabrasConsulta.filter(p => textoFila.includes(p))
    return matches.length >= Math.min(2, palabrasConsulta.length)
  })

  if (coincidencias.length === 0) {
    return 'No encontré ese modelo exacto. ¿Me confirmás modelo, capacidad y color? (ej: "iPhone 17 Pro 256GB azul"). También podés ver todo el catálogo en www.iphoneneuquen.com 📱'
  }

  const disponibles = coincidencias.filter(f => (f.estado_stock || '').toLowerCase().includes('disponible'))

  if (disponibles.length === 0) {
    return `Encontré "${coincidencias[0].modelo} ${coincidencias[0].capacidad}" pero no tenemos stock disponible ahora mismo. ¿Querés que te avisemos cuando entre, o te interesa ver alternativas? Mirá el catálogo completo en www.iphoneneuquen.com`
  }

  const lineas = disponibles.slice(0, 5).map(f => {
    const precio = f.precio_usd_publico || f.precio_usd
    return `📱 ${f.modelo} ${f.capacidad} ${f.color} — US$ ${precio}`
  })

  const extra = disponibles.length > 5 ? `\n\n(y ${disponibles.length - 5} opciones más — mirá todo en www.iphoneneuquen.com)` : ''

  return `¡Tenemos esto disponible! ✅\n\n${lineas.join('\n')}${extra}\n\n¿Te interesa alguno? Contame y coordinamos.`
}

// Lee la hoja "Stock_Web" como CSV público (la planilla debe estar compartida
// como "Cualquier persona con el enlace puede ver").
async function leerPlanillaStock() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`No se pudo leer la planilla de stock (${resp.status})`)
  const csv = await resp.text()
  return parsearCSV(csv)
}

function normalizar(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Parser de CSV simple (soporta comillas básicas). Devuelve un array de objetos
// usando la primera fila como encabezados.
function parsearCSV(csv) {
  const lineas = csv.split('\n').filter(l => l.trim().length > 0)
  if (lineas.length === 0) return []

  const parsearLinea = (linea) => {
    const valores = []
    let actual = ''
    let dentroComillas = false
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i]
      if (c === '"') {
        dentroComillas = !dentroComillas
      } else if (c === ',' && !dentroComillas) {
        valores.push(actual.trim())
        actual = ''
      } else {
        actual += c
      }
    }
    valores.push(actual.trim())
    return valores
  }

  const headers = parsearLinea(lineas[0])
  return lineas.slice(1).map(linea => {
    const valores = parsearLinea(linea)
    const obj = {}
    headers.forEach((h, i) => { obj[h] = valores[i] || '' })
    return obj
  })
}

// Manda un mensaje de texto por WhatsApp usando la Cloud API de Meta.
async function enviarMensajeWhatsApp(destinatario, texto) {
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
  const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN

  const resp = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: destinatario,
      type: 'text',
      text: { body: texto },
    }),
  })

  if (!resp.ok) {
    const errorBody = await resp.text()
    console.error('Error al enviar mensaje de WhatsApp:', errorBody)
  }
}
