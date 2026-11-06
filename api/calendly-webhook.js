// api/calendly-webhook.js — Calendly avisa acá cada vez que alguien saca un turno.
// El contacto de ManyChat recibe la etiqueta "Turno compra" o "Turno canje" y
// el campo bot_turno con la fecha y hora.
//
// Cómo se encuentra el contacto:
//   1. Por el link: el bot manda el link de compra con ?utm_content=<id de ManyChat>.
//   2. Si no viene (por ejemplo, el link de canje que manda JC), por el teléfono
//      que la persona carga en Calendly, contra el campo bot_tel de ManyChat.
//
// Variables de entorno: CALENDLY_TOKEN y MANYCHAT_TOKEN.
// Para registrar el webhook en Calendly una sola vez: GET /api/calendly-webhook?setup=1

import crypto from "node:crypto";
import { buscarPorTelefono, guardarCampo, hayManychat, normalizarTelefono, ponerEtiqueta } from "./_manychat.js";

export const config = { api: { bodyParser: false } };

const CALENDLY = "https://api.calendly.com";

export default async function handler(req, res) {
  if (!process.env.CALENDLY_TOKEN || !hayManychat()) {
    return res.status(503).json({ error: "Faltan CALENDLY_TOKEN o MANYCHAT_TOKEN" });
  }

  if (req.method === "GET" && req.query?.setup === "1") {
    try {
      return res.status(200).json(await registrarWebhook(urlPublica(req)));
    } catch (e) {
      console.error("calendly setup error:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const crudo = await leerCuerpo(req);
  if (!firmaValida(crudo, req.headers["calendly-webhook-signature"])) {
    return res.status(401).json({ error: "Firma inválida" });
  }

  try {
    const evento = JSON.parse(crudo);
    const resultado = evento.event === "invitee.created" ? await procesarTurno(evento.payload) : { ignorado: evento.event };
    console.log("calendly:", JSON.stringify(resultado));
    return res.status(200).json(resultado);
  } catch (e) {
    console.error("calendly webhook error:", e);
    // 200 igual: si devolvemos error, Calendly reintenta y duplicaría etiquetas.
    return res.status(200).json({ error: e.message });
  }
}

export async function procesarTurno(p) {
  const nombreEvento = String(p?.scheduled_event?.name || "");
  const etiqueta = /canje/i.test(nombreEvento) ? "Turno canje" : "Turno compra";

  let contacto = String(p?.tracking?.utm_content || "").match(/^\d+$/)?.[0] || null;
  let via = "link";
  if (!contacto) {
    via = "telefono";
    for (const tel of telefonosDelTurno(p)) {
      contacto = await buscarPorTelefono(tel);
      if (contacto) break;
    }
  }
  if (!contacto) return { etiqueta, encontrado: false, telefonos: telefonosDelTurno(p) };

  await ponerEtiqueta(contacto, etiqueta);
  await guardarCampo(contacto, "bot_turno", `${nombreEvento} — ${fechaTurno(p?.scheduled_event?.start_time)}`);
  return { etiqueta, encontrado: true, via, contacto };
}

// Teléfonos posibles: la pregunta "Número de contacto" (o similar) y el de recordatorio por SMS.
export function telefonosDelTurno(p) {
  const respuestas = (p?.questions_and_answers || [])
    .filter((qa) => /tel|n[uú]mero|whats|celu|contacto/i.test(qa.question))
    .map((qa) => qa.answer);
  return [...new Set([...respuestas, p?.text_reminder_number].map(normalizarTelefono).filter(Boolean))];
}

function fechaTurno(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

// La clave de firma sale del token, así no hace falta otra variable de entorno.
function claveDeFirma() {
  return crypto.createHmac("sha256", process.env.CALENDLY_TOKEN).update("driphone-webhook").digest("hex");
}

function firmaValida(crudo, cabecera) {
  const partes = Object.fromEntries(String(cabecera || "").split(",").map((p) => p.trim().split("=")));
  if (!partes.t || !partes.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(partes.t)) > 600) return false;
  const esperada = crypto.createHmac("sha256", claveDeFirma()).update(`${partes.t}.${crudo}`).digest("hex");
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(partes.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Hay que leer el cuerpo tal cual llegó para verificar la firma. No se toca req.body
// antes, porque en Vercel eso lo parsea y consume el stream.
async function leerCuerpo(req) {
  const partes = [];
  for await (const parte of req) partes.push(Buffer.from(parte));
  if (partes.length) return Buffer.concat(partes).toString("utf8");
  const b = req.body;
  return typeof b === "string" ? b : Buffer.isBuffer(b) ? b.toString("utf8") : JSON.stringify(b ?? {});
}

function urlPublica(req) {
  return `https://${req.headers["x-forwarded-host"] || req.headers.host}/api/calendly-webhook`;
}

async function calendly(ruta, opciones = {}) {
  const r = await fetch(`${CALENDLY}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${process.env.CALENDLY_TOKEN}`, "Content-Type": "application/json" },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Calendly ${ruta} respondió ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function registrarWebhook(url) {
  const { resource: yo } = await calendly("/users/me");
  const org = yo.current_organization;
  const existentes = await calendly(
    `/webhook_subscriptions?organization=${encodeURIComponent(org)}&user=${encodeURIComponent(yo.uri)}&scope=user`,
  );
  const ya = (existentes.collection || []).find((w) => w.callback_url === url);
  if (ya) return { estado: "ya estaba registrado", url, creado: ya.created_at };

  await calendly("/webhook_subscriptions", {
    method: "POST",
    body: JSON.stringify({
      url,
      events: ["invitee.created"],
      organization: org,
      user: yo.uri,
      scope: "user",
      signing_key: claveDeFirma(),
    }),
  });
  return { estado: "registrado", url };
}
