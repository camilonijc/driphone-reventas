// api/_manychat.js — Llamadas a la API de ManyChat (etiquetas y campos de contacto).
// No es una ruta pública: Vercel ignora los archivos que empiezan con "_".
//
// Variable de entorno: MANYCHAT_TOKEN (Configuración → API → token de la cuenta).

const API = "https://api.manychat.com/fb";

export function hayManychat() {
  return Boolean(process.env.MANYCHAT_TOKEN);
}

async function llamar(ruta, { method = "GET", body } = {}) {
  const r = await fetch(`${API}${ruta}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.MANYCHAT_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.status === "error") {
    throw new Error(`ManyChat ${ruta} respondió ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.data;
}

export function ponerEtiqueta(contacto, etiqueta) {
  return llamar("/subscriber/addTagByName", {
    method: "POST",
    body: { subscriber_id: Number(contacto), tag_name: etiqueta },
  });
}

export function guardarCampo(contacto, campo, valor) {
  return llamar("/subscriber/setCustomFieldByName", {
    method: "POST",
    body: { subscriber_id: Number(contacto), field_name: campo, field_value: String(valor) },
  });
}

let idsDeCampos = null;
async function idDeCampo(nombre) {
  if (!idsDeCampos) {
    const campos = await llamar("/page/getCustomFields");
    idsDeCampos = Object.fromEntries((campos || []).map((c) => [c.name, c.id]));
  }
  return idsDeCampos[nombre];
}

// Busca el contacto cuyo campo bot_tel coincide con el teléfono (ya normalizado).
export async function buscarPorTelefono(telefono) {
  const id = await idDeCampo("bot_tel");
  if (!id || !telefono) return null;
  const encontrados = await llamar(
    `/subscriber/findByCustomField?field_id=${id}&field_value=${encodeURIComponent(telefono)}`,
  );
  return encontrados?.[0]?.id || null;
}

// Lleva un número argentino a un formato único: 549 + código de área + número, sin el 15.
// "+54 9 299 412-3456", "0299 15 412 3456" y "5492994123456" dan "5492994123456".
export function normalizarTelefono(texto) {
  let d = String(texto || "").replace(/\D/g, "");
  if (!d) return "";
  d = d.replace(/^00/, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9") && d.length === 11) d = d.slice(1);
  d = d.replace(/^0/, "");
  if (d.length === 12) {
    // Código de área de 2, 3 o 4 cifras seguido de 15.
    for (const largo of [3, 2, 4]) {
      if (d.slice(largo, largo + 2) === "15") {
        d = d.slice(0, largo) + d.slice(largo + 2);
        break;
      }
    }
  }
  return d.length === 10 ? `549${d}` : d;
}
