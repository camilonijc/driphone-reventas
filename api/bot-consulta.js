import { guardarCampo, hayManychat, normalizarTelefono, ponerEtiqueta } from "./_manychat.js";

// api/bot-consulta.js — Respuestas del bot de WhatsApp (ManyChat) de Dr.iPhone.
//
// ManyChat hace POST con { "q": "<mensaje del cliente>" } y usa de la respuesta:
//   respuesta -> texto para mandar al cliente
//   tipo      -> saludo | humano | comprar | canje | canje_recibido | pase_informacion |
//                pago | dolar | ubicacion | horario | garantia | producto |
//                sin_resultado | cierre
//
// ManyChat también manda prev con el tipo anterior: si era "canje", el mensaje actual
// son los datos del equipo del cliente.
//   deriva    -> "si" cuando hay que asignarle la charla a JC
//   abierto   -> "si" | "no", según el horario del local
//   enviar    -> "no" cuando no hay que mandar nada (foto, audio o mensaje repetido)
//   modelo    -> contexto del último producto consultado (ManyChat lo devuelve en "modelo")
//   menu      -> "si": botones Productos nuevos / iPhone usados / Plan canje
//                "categorias": botones iPhone / iPad / Mac / Apple Watch / AirPods / Samsung
//   ultimo    -> el mensaje actual (ManyChat lo devuelve en "ultimo" para detectar repetidos)
//
// Solo informa precio público en USD. Nunca lee ni devuelve precios de reventa,
// costos ni valores en pesos.

const WEB = "www.iphoneneuquen.com";
const AVISO_PERSONA = "Si preferís, escribí *persona* y te atiende alguien del equipo.";
const MAX_LINEAS = 8;
const OPCIONES_MENU = `Elegí *Productos nuevos*, *iPhone usados* o *Plan canje*, o escribime directamente qué buscás.\n\n${AVISO_PERSONA}`;
const TIMBRE = "Tocá el timbre negro por favor, ya te van a atender.";

// El id del contacto va en el link para que Calendly lo devuelva al sacar el turno
// (api/calendly-webhook.js) y se le ponga la etiqueta "Turno compra".
const turnoCompra = (contacto) => `Para sacar tu turno podés hacerlo desde este link:
https://calendly.com/driphoneneuquen/compra-directa${contacto ? `?utm_content=${contacto}` : ""}

En caso de encontrarse ocupado el horario, consultar para un sobreturno. Normalmente no hay inconvenientes.`;

const PASE_INFORMACION = `📲 ¿Venís a hacer un canje y querés que te pasemos la información al equipo nuevo?

Para hacerlo rápido y sin vueltas, necesitamos que vengas con esto listo:

✅ Sabé tu contraseña de iCloud (Apple ID). Sin ella no podemos pasar tus datos ni desvincular el equipo.

✅ Restablecé el Face ID:
Andá a Ajustes > Face ID y código > Restablecer Face ID.
Así no vamos a necesitar tu cara durante el proceso y el pase de información sale mucho más rápido.

⚠️ ¿No te aparece disponible la opción "Restablecer Face ID"?
Eso pasa porque tenés activada la Protección en caso de robo. En ese caso, primero desactivala:
Ajustes > Face ID y código > Protección en caso de robo > Desactivar.
Después de eso ya vas a poder restablecer el Face ID.

💡 Te recomendamos hacerlo en tu casa antes de venir, porque fuera de tu casa el iPhone puede pedirte esperar 1 hora por seguridad.`;

const COLORES = {
  black: ["black", "negro", "negra", "midnight", "medianoche"],
  white: ["white", "blanco", "blanca", "starlight"],
  blue: ["blue", "azul", "celeste", "sky"],
  pink: ["pink", "rosa", "rosado", "rosada"],
  green: ["green", "verde"],
  orange: ["orange", "naranja"],
  silver: ["silver", "plata", "plateado", "plateada"],
  purple: ["purple", "violet", "violeta", "lavender", "lavanda"],
  desert: ["desert", "desierto"],
  natural: ["natural"],
  borgona: ["borgona", "burgundy"],
  glaciar: ["glaciar", "glacier"],
  citrus: ["citrus"],
};

const CATEGORIAS = [
  { nombre: "Samsung", regex: /\b(samsung|galaxy|s\s?26|ultra)\b/ },
  { nombre: "iPad", regex: /\bipad\b/ },
  { nombre: "Airpods", regex: /\b(airpods?|auriculares?)\b/ },
  { nombre: "Apple Watch", regex: /\b(apple\s?watch|watch|reloj)\b/ },
  { nombre: "MacBook", regex: /\b(macbook|mac|notebook)\b/ },
  { nombre: "Airtag", regex: /\bair\s?tags?\b/ },
];

const PALABRAS_VACIAS = new Set([
  "hola", "buenas", "buen", "dia", "tardes", "noches", "tenes", "tienen", "tenés", "hay",
  "precio", "precios", "cuanto", "cuesta", "sale", "vale", "valor", "stock", "disponible",
  "el", "la", "los", "las", "un", "una", "de", "del", "en", "por", "para", "con", "me",
  "que", "quiero", "busco", "estoy", "buscando", "nuevo", "nuevos", "nueva", "sellado",
  "usado", "usados", "usada", "gb", "tb", "apple", "iphone", "iphones", "gracias",
]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const campo = (nombre) => limpiarCampo(req.body?.[nombre] ?? req.query?.[nombre]);
  const q = campo("q").slice(0, 300);
  const previo = campo("prev");
  const ultimo = campo("ultimo");
  const modeloPrevio = campo("modelo");
  const contacto = campo("id").match(/^\d+$/)?.[0] || "";
  const telefono = normalizarTelefono(campo("tel"));

  try {
    const { registro, ...respuesta } = await responder(q, new Date(), previo, { ultimo, modelo: modeloPrevio, contacto });
    // ManyChat guarda tel en bot_tel: sirve para encontrar al contacto cuando saca turno.
    if (telefono) respuesta.tel = telefono;
    if (req.method === "POST") {
      await Promise.all([
        registrarConsulta(respuesta, registro, q),
        etiquetarAvisar(contacto, respuesta, registro),
      ]);
    }
    return res.status(200).json(respuesta);
  } catch (e) {
    console.error("bot-consulta error:", e);
    return res.status(200).json(salida(
      "error",
      `En este momento no puedo consultar el stock. Podés verlo en ${WEB}. ${AVISO_PERSONA}`,
    ));
  }
}

// ManyChat deja el texto "{{campo}}" cuando el campo está vacío.
function limpiarCampo(valor) {
  const texto = String(valor ?? "").trim();
  return /^\{\{.*\}\}$/.test(texto) ? "" : texto;
}

export async function responder(q, ahora = new Date(), previo = "", extra = {}) {
  const r = await responderSinContexto(q, ahora, previo, extra);
  return {
    ...r,
    enviar: r.enviar || "si",
    menu: r.menu || (r.enviar !== "no" && (r.tipo === "saludo" || (r.tipo === "sin_resultado" && !r.registro)) ? "si" : "no"),
    modelo: r.modelo || extra.modelo || "-",
    ultimo: q,
  };
}

async function responderSinContexto(q, ahora, previo, extra) {
  const texto = normalizar(q);
  const abierto = estaAbierto(ahora);

  // Sin texto o igual al mensaje anterior: ManyChat repite el último texto cuando el
  // cliente manda fotos, audios o stickers. No se contesta para no repetir respuestas.
  if (!texto || texto === normalizar(extra.ultimo)) {
    return { ...salida(previo || "sin_texto", "", abierto), enviar: "no" };
  }

  if (texto.length <= 60 && /\b(llegue|ya llegue|ya estoy|estoy abajo|abajo|estoy afuera|aca afuera|afuera|en la puerta|estoy aca|aca estoy|estoy en el local|estoy en la oficina)\b/.test(texto)) {
    return salida("llegada", TIMBRE, abierto);
  }

  if (/\b(person\w*|perosna|presona|pesona|humano|humana|asesor\w*|vendedor\w*|operador\w*|juan|atienda|atiende alguien|hablar con alguien|hablo con|sos (un )?bot|sos juan|atendiendo vos)\b/.test(texto)) {
    return salida("humano", mensajeDerivacion(abierto, "Te paso con una persona del equipo."), abierto, true);
  }

  // Si el mensaje anterior pidió los datos del canje, este mensaje son esos datos.
  if (previo === "canje" || texto === "canje recibido") {
    return salida("canje_recibido", mensajeCanjeRecibido(abierto), abierto, true);
  }

  if (/\b(pase de (informacion|datos)|pasar (la )?(informacion|info|datos)|pasen (la )?(informacion|info|datos))\b/.test(texto)) {
    return salida("pase_informacion", PASE_INFORMACION, abierto);
  }

  const esCanje = esConsultaCanje(texto);

  if (esCanje) {
    return salida(
      "canje",
      "¡Dale! Para cotizar tu equipo, pasame en un solo mensaje: modelo, capacidad, condición de batería y estado general.",
      abierto,
    );
  }

  if (/\b(cambiar(le)? (la |el )?(pantalla|bateria|modulo|camara|vidrio|tapa|pin)|cambio de (pantalla|bateria|modulo|camara)|reparar|reparan|reparacion|reparaciones|arreglar|arreglan|arreglo|se (me )?rompio|service|servicio tecnico|tecnico|no carga|no prende|se mojo)\b/.test(texto)) {
    return salida("reparacion", mensajeDerivacion(abierto, "Por reparaciones o service te responde una persona del equipo."), abierto, true);
  }

  if (/\b(quiero (comprar|comprarlo|llevarlo|reservar|reservarlo|ese|este)|lo quiero|lo compro|me lo llevo|comprar|reservar|reserva|sena|senar|turno|turnos)\b/.test(texto)) {
    return salida("comprar", `${turnoCompra(extra.contacto)}\n\n${siguePersona(abierto)}`, abierto, true);
  }

  if (/\b(cotizacion|dolar|tipo de cambio)\b/.test(texto)) {
    return salida("dolar", `La cotización actualizada del dólar está en ${WEB}.`, abierto);
  }

  const preguntaPago = /\b(cuotas?|tarjeta|tarjetas|financiacion|financiar|financian|mercado ?pago|credito|debito|formas? de pago|medios? de pago|como pago|se puede pagar)\b/.test(texto);
  const mencionaPago = /\b(efectivo|transferencia|crypto|cripto|usdt)\b/.test(texto);
  const consulta = completarConContexto(interpretarProducto(texto), leerContexto(extra.modelo), texto);

  if (preguntaPago || (mencionaPago && !consulta.hayPedido)) {
    return salida(
      "pago",
      `No aceptamos cuotas ni ningún método de financiación.\n\nPrecios en USD: solo en efectivo.\nPesos: efectivo y transferencia, con valores en ${WEB}.\nCrypto: USDT.`,
      abierto,
    );
  }

  if (/\b(pesos|ars)\b/.test(texto)) {
    return salida("pago", `Los valores en pesos, en efectivo y por transferencia, están en ${WEB}.`, abierto);
  }

  if (/\b(garantia|garantias)\b/.test(texto)) {
    return salida(
      "garantia",
      "Nuevos: 12 meses de garantía oficial Apple, válida en MacStation, iPoint y OneClick en todo el país.\nUsados: 30 días de garantía.",
      abierto,
    );
  }

  if (/\b(donde|ubicacion|ubicados|direccion|local|oficina|como llego)\b/.test(texto)) {
    return salida("ubicacion", "Estamos en Elordi 82, Neuquén Capital.\n\nLunes a viernes de 9:30 a 18:30.\nSábados de 11 a 14.\n\nPara pasar a comprar hay que sacar turno. Escribí *turno* y te paso el link.", abierto);
  }

  if (/\b(horario|horarios|hora|abren|abierto|cierran|atienden)\b/.test(texto)) {
    return salida("horario", "Atendemos de lunes a viernes de 9:30 a 18:30 y los sábados de 11 a 14.", abierto);
  }

  if (/\b(menu|opciones|ayuda|empezar|inicio)\b/.test(texto)) return salida("saludo", saludo(), abierto);

  if (!consulta.hayPedido) {
    if (/\b(gracias|genial|perfecto|dale|ok|okey)\b/.test(texto)) {
      return salida("cierre", "¡De nada! Si necesitás algo más, escribime.", abierto);
    }
    if (/\b(hol+a+s?|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|que tal|como va|como andas|como estas|como esta|todo bien|una consulta|consulta|consultita|consultar|amigo|amiga|querido|querida|estas)\b/.test(texto)) {
      return salida("saludo", saludo(), abierto);
    }
    return salida(
      "sin_resultado",
      `No te entendí bien. ¿Qué estás buscando?\n\n${OPCIONES_MENU}`,
      abierto,
    );
  }

  // "Productos nuevos" o "iPhone nuevo" sin modelo (o el botón del menú): se pregunta cuál.
  if (!consulta.iphone && !consulta.categoria && !consulta.pideUsados && !consulta.bateria
    && !consulta.capacidad && !consulta.color && (consulta.pideNuevos || consulta.pideIphone)) {
    const mensaje = consulta.pideIphone
      ? "¡Dale! ¿Qué modelo buscás? Por ejemplo: *iPhone 17 Pro 256GB*."
      : "¡Dale! ¿Qué producto buscás? Tenemos iPhone, iPad, Mac, Apple Watch, AirPods y Samsung. Escribime el modelo, por ejemplo: *iPhone 17 Pro 256GB* o *Apple Watch Series 11*.";
    // Sin modelo ni categoría: ManyChat muestra los botones de categorías.
    return { ...salida("pide_modelo", mensaje, abierto), menu: consulta.pideIphone ? "no" : "categorias" };
  }

  const { nuevos, usados } = await leerStock();
  const resultado = salida(...respuestaProducto(consulta, nuevos, usados), abierto);
  return { ...resultado, modelo: contextoDe(consulta), registro: datosProducto(consulta, resultado) };
}

function salida(tipo, respuesta, abierto = false, deriva = false) {
  return { respuesta, tipo, deriva: deriva ? "si" : "no", abierto: abierto ? "si" : "no" };
}

function saludo() {
  return `¡Hola! Soy el asistente virtual de Dr.iPhone. ¿Qué estás buscando?\n\n${OPCIONES_MENU}`;
}

function esConsultaCanje(texto) {
  if (/\b(dolar|tipo de cambio)\b/.test(texto)) return false;
  if (/\b(canje|canjes|canjear|canjeo|canjean|permuta|permutar|permutan|parte de pago|entrego|entregar? mi|tomas? mi|toman mi|tomarias|reciben mi|vendo mi|vender mi|quiero vender|cuanto (me )?(das|dan|pagas|pagan|tomas|toman|ofreces|ofrecen)|cuanto vale mi|cuanto sale mi)\b/.test(texto)) return true;
  if (/\b(cotizar|cotizarme|cotizame|cotizamelo|cotizas|cotizan|cotizen|cotice)\b/.test(texto)) return true;
  return /\bcotizacion\b/.test(texto) && /\b(iphone|celu|celular|telefono|equipo|mi|usado|\d{2})\b/.test(texto);
}

// El enlace de turno de canje lo manda JC cuando el cliente acepta el valor.
function mensajeCanjeRecibido(abierto) {
  return abierto
    ? "¡Gracias! Ya recibimos los datos de tu equipo. En breve te contestamos por acá con el valor de canje."
    : "¡Gracias! Ya recibimos los datos de tu equipo. Ahora estamos cerrados: te contestamos con el valor de canje apenas abramos.";
}

function siguePersona(abierto) {
  return abierto
    ? "Si tenés alguna duda, una persona del equipo te responde por acá."
    : "Si tenés alguna duda, te responde una persona del equipo cuando abramos.";
}

function mensajeDerivacion(abierto, inicio) {
  if (abierto) return `${inicio} Te responde en breve.`;
  return `${inicio} Ahora estamos cerrados: te contesta apenas abramos.\n\nAtendemos de lunes a viernes de 9:30 a 18:30 y los sábados de 11 a 14.`;
}

function normalizar(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!.,;:()"'*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extraerColor(texto) {
  const palabras = texto.split(" ");
  for (const [color, nombres] of Object.entries(COLORES)) {
    if (nombres.some((n) => palabras.includes(n))) return color;
  }
  return null;
}

function colorDeFila(fila) {
  return extraerColor(normalizar(fila.color));
}

function extraerCapacidad(texto) {
  const m = texto.match(/\b(64|128|256|512)\s*(?:gb|g|gigas?)?\b|\b([12])\s*(?:tb|tera)\b/);
  if (!m) return null;
  return m[1] ? `${m[1]}gb` : `${m[2]}tb`;
}

function capacidadDeFila(fila) {
  const m = normalizar(fila.capacidad).replace(/\s/g, "");
  const conAlmacenamiento = m.match(/(64|128|256|512)gb|([12])tb/);
  return conAlmacenamiento ? conAlmacenamiento[0] : m;
}

// Convierte "17 ProMax", "16PM" o "iphone 16 pro max" en una clave común: "17promax".
function claveIphone(texto) {
  const limpio = texto
    .replace(/\b(64|128|256|512)\s*(gb|g|gigas?)?\b/g, " ")
    .replace(/\biphone\b/g, " ");
  const m = limpio.match(/\b(1[1-9]|2\d)\s*(e|plus)?\s*(pro\s*max|promax|pm|pro)?\b/);
  if (!m) return null;
  const variante = (m[3] || "").replace(/\s/g, "").replace("pm", "promax");
  return `${m[1]}${m[2] || ""}${variante}`;
}

function interpretarProducto(texto) {
  const categoria = CATEGORIAS.find((c) => c.regex.test(texto))?.nombre || null;
  const iphone = categoria ? null : claveIphone(texto);
  const pideIphone = /\biphones?\b/.test(texto);
  const pideUsados = /\b(usado|usados|usada|segunda mano)\b/.test(texto) || Boolean(extraerBateria(texto));
  const pideNuevos = /\b(nuevo|nuevos|nueva|sellado|sellados)\b/.test(texto);

  return {
    texto,
    categoria,
    iphone,
    pideIphone,
    pideUsados,
    pideNuevos,
    color: extraerColor(texto),
    capacidad: extraerCapacidad(texto),
    bateria: extraerBateria(texto),
    hayPedido: Boolean(categoria || iphone || pideIphone || pideUsados || pideNuevos),
  };
}

// "90%", "batería 90" o "90 de batería" -> 90 (se buscan usados con esa batería o más).
function extraerBateria(texto) {
  const m = texto.match(/\b(\d{2,3})\s*%|\bbateria (?:de |del |al )?(\d{2,3})\b|\b(\d{2,3}) (?:de |%)?bateria\b/);
  const n = m ? Number(m[1] || m[2] || m[3]) : 0;
  return n >= 70 && n <= 100 ? n : null;
}

// Contexto del último producto consultado, guardado en ManyChat como texto corto.
function contextoDe(c) {
  const partes = [];
  if (c.iphone) partes.push(`i=${c.iphone}`);
  if (c.categoria) partes.push(`c=${c.categoria}`);
  if (c.pideIphone) partes.push("p=1");
  if (c.pideUsados) partes.push("u=1");
  if (c.pideNuevos) partes.push("n=1");
  if (c.capacidad) partes.push(`cap=${c.capacidad}`);
  if (c.color) partes.push(`col=${c.color}`);
  if (c.bateria) partes.push(`bat=${c.bateria}`);
  return partes.join(";") || "-";
}

function leerContexto(texto) {
  const datos = Object.fromEntries(String(texto || "").split(";")
    .map((p) => p.split("=")).filter((p) => p.length === 2));
  if (!datos.i && !datos.c && !datos.p && !datos.u && !datos.n) return null;
  return datos;
}

// "En color azul", "¿ese es pro?" o "con más de 90%" después de consultar un modelo:
// se completa con el modelo anterior.
function completarConContexto(consulta, ctx, texto) {
  if (!ctx) return consulta;
  const variante = texto.match(/\b(pro max|promax|pro|plus|max)\b/)?.[1];
  if (consulta.hayPedido) {
    return consulta.bateria && !consulta.iphone && !consulta.categoria && ctx.i
      ? { ...consulta, iphone: ctx.i, pideUsados: true }
      : consulta;
  }
  if (!consulta.color && !consulta.capacidad && !consulta.bateria && !(variante && ctx.i)) return consulta;

  let iphone = ctx.i || null;
  if (iphone && variante) {
    const base = iphone.match(/^\d+/)[0];
    iphone = base + ({ "pro max": "promax", max: "promax", promax: "promax", pro: "pro", plus: "plus" }[variante]);
  }
  return {
    ...consulta,
    iphone,
    categoria: ctx.c || null,
    pideIphone: ctx.p === "1",
    pideUsados: ctx.u === "1" || Boolean(consulta.bateria),
    pideNuevos: ctx.n === "1" && !consulta.bateria,
    capacidad: consulta.capacidad || ctx.cap || null,
    color: consulta.color || ctx.col || null,
    bateria: consulta.bateria || (ctx.bat ? Number(ctx.bat) : null),
    hayPedido: true,
  };
}

function respuestaProducto(consulta, nuevos, usados) {
  let candidatosNuevos = consulta.pideUsados || consulta.bateria ? [] : nuevos;
  let candidatosUsados = consulta.pideNuevos || consulta.categoria ? [] : usados;

  if (consulta.iphone) {
    candidatosNuevos = candidatosNuevos.filter((f) => esIphone(f) && claveFila(f) === consulta.iphone);
    candidatosUsados = candidatosUsados.filter((f) => claveFila(f) === consulta.iphone);
  } else if (consulta.categoria) {
    candidatosNuevos = filtrarCategoria(candidatosNuevos, consulta);
  } else if (consulta.pideIphone) {
    candidatosNuevos = candidatosNuevos.filter(esIphone);
  }

  const elegidos = [...candidatosNuevos, ...candidatosUsados];
  const conTodo = elegidos.filter((f) => coincideCapacidad(f, consulta) && coincideColor(f, consulta)
    && coincideBateria(f, consulta));
  const disponiblesExactos = conTodo.filter((f) => f.disponible);
  const nombre = nombreConsulta(consulta);

  if (disponiblesExactos.length) {
    return ["producto", armarLista(disponiblesExactos)];
  }

  const alternativas = elegidos.filter((f) => f.disponible);
  if (alternativas.length) {
    return ["producto", `De ${nombre} con esas características no tengo disponible ahora, pero sí esto:\n\n${armarLista(alternativas)}`];
  }

  if (elegidos.length) {
    return ["sin_resultado", `Por ahora no tenemos ${nombre} disponible. Podés ver todo el catálogo en ${WEB}.\n\n${AVISO_PERSONA}`];
  }

  return ["sin_resultado", `No encontré ${nombre}. Podés ver todo el catálogo en ${WEB}.\n\n${AVISO_PERSONA}`];
}

function datosProducto(consulta, resultado) {
  const modelo = [nombreConsulta(consulta), consulta.capacidad?.toUpperCase(), consulta.color]
    .filter(Boolean).join(" ");
  let stock = "Sí";
  if (resultado.tipo !== "producto") stock = "No";
  else if (resultado.respuesta.startsWith("De ")) stock = "Parcial";
  return { modelo, stock };
}

function esIphone(fila) {
  return fila.categoria === "iPhone" && /^\d/.test(String(fila.modelo).trim());
}

function claveFila(fila) {
  const texto = normalizar(fila.modelo);
  return claveIphone(texto) || texto.replace(/\s/g, "");
}

function filtrarCategoria(filas, consulta) {
  const deCategoria = filas.filter((f) => f.categoria === consulta.categoria
    || (consulta.categoria === "Airtag" && /airtag/.test(normalizar(f.modelo))));
  const vocabulario = new Set(deCategoria.flatMap((f) => normalizar(f.modelo).split(" ")));
  const pedidas = consulta.texto.split(" ").filter((p) =>
    vocabulario.has(p) && !PALABRAS_VACIAS.has(p) && !/^(samsung|ipad|airpods|watch|macbook)$/.test(p));
  if (!pedidas.length) return deCategoria;
  const coinciden = deCategoria.filter((f) => {
    const modelo = normalizar(f.modelo).split(" ");
    return pedidas.every((p) => modelo.includes(p));
  });
  return coinciden.length ? coinciden : deCategoria;
}

function coincideCapacidad(fila, consulta) {
  return !consulta.capacidad || capacidadDeFila(fila) === consulta.capacidad;
}

function coincideBateria(fila, consulta) {
  return !consulta.bateria || (parseInt(String(fila.bateria), 10) || 0) >= consulta.bateria;
}

function coincideColor(fila, consulta) {
  return !consulta.color || colorDeFila(fila) === consulta.color;
}

function nombreConsulta(consulta) {
  if (consulta.iphone) return nombreIphone(consulta.iphone);
  if (consulta.categoria) return consulta.categoria;
  if (consulta.pideUsados) return "usados";
  if (consulta.pideNuevos) return "nuevos";
  if (consulta.pideIphone) return "iPhone";
  return "ese producto";
}

function armarLista(filas) {
  const nuevos = filas.filter((f) => !f.esUsado);
  const usados = filas.filter((f) => f.esUsado);
  const lineas = [];

  if (nuevos.length) {
    lineas.push("*Nuevos, sellados*");
    nuevos.slice(0, MAX_LINEAS).forEach((f) => lineas.push(lineaNuevo(f)));
  }
  if (usados.length) {
    if (lineas.length) lineas.push("");
    lineas.push("*Usados*");
    usados.slice(0, MAX_LINEAS).forEach((f) => lineas.push(lineaUsado(f)));
  }

  const ocultos = Math.max(0, nuevos.length - MAX_LINEAS) + Math.max(0, usados.length - MAX_LINEAS);
  lineas.push("");
  if (ocultos) lineas.push(`Hay ${ocultos} opciones más en ${WEB}.`);
  lineas.push("Precios en USD, en efectivo. Para seguir, escribí *comprar* o *persona*.");
  return lineas.join("\n");
}

function lineaNuevo(f) {
  const nombre = esIphone(f) ? nombreIphone(f.modelo) : titulo(f.modelo);
  const partes = [nombre, f.capacidad, titulo(f.color)].filter(Boolean).join(" ");
  return `• ${partes}: US$ ${precioTexto(f.precio)}`;
}

function lineaUsado(f) {
  const partes = [nombreIphone(f.modelo), f.capacidad, titulo(f.color)].filter(Boolean).join(" ");
  const bateria = f.bateria ? `, batería ${f.bateria}` : "";
  return `• ${partes}${bateria}: US$ ${precioTexto(f.precio)}`;
}

function nombreIphone(modelo) {
  const clave = claveIphone(normalizar(modelo)) || normalizar(modelo);
  const m = clave.match(/^(\d+)(e|plus)?(promax|pro)?/);
  if (!m) return `iPhone ${titulo(modelo)}`;
  const sufijo = { e: "e", plus: " Plus" }[m[2]] || "";
  const variante = { promax: " Pro Max", pro: " Pro" }[m[3]] || "";
  return `iPhone ${m[1]}${sufijo}${variante}`;
}

function precioTexto(valor) {
  return String(valor).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function titulo(s) {
  const texto = String(s || "").trim();
  if (texto !== texto.toUpperCase() || /\d/.test(texto)) return texto;
  return texto.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

async function leerStock() {
  const [filasNuevos, filasUsados] = await Promise.all([
    leerHoja("Stock_Web!A2:M300"),
    leerHoja("Usados!A2:L300"),
  ]);
  return { nuevos: parsearNuevos(filasNuevos), usados: parsearUsados(filasUsados) };
}

async function leerHoja(rango) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.SHEET_ID}/values/${encodeURIComponent(rango)}?key=${process.env.GOOGLE_API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Google Sheets respondió ${r.status}`);
  return (await r.json()).values || [];
}

export function parsearNuevos(filas) {
  return filas
    .filter((r) => r[0] && r[1])
    .map((r) => {
      const precio = parseFloat(r[12]) || 0;
      const estado = String(r[7] || "").trim().toLowerCase();
      const cantidad = parseInt(r[11], 10) || 0;
      return {
        modelo: r[1],
        capacidad: String(r[2] || "").trim(),
        color: r[3] || "",
        categoria: r[10] || "",
        precio,
        esUsado: false,
        disponible: estado === "disponible" && cantidad > 0 && precio > 0,
      };
    });
}

export function parsearUsados(filas) {
  return filas
    .filter((r) => r[0] && r[1])
    .map((r) => {
      const precio = parseFloat(r[8]) || 0;
      return {
        modelo: r[1],
        capacidad: String(r[2] || "").trim(),
        bateria: String(r[3] || "").trim(),
        color: r[4] || "",
        categoria: "iPhone",
        precio,
        esUsado: true,
        disponible: String(r[5] || "").trim() === "EN STOCK" && precio > 0,
      };
    });
}

// Horario de Neuquén (UTC-3): lunes a viernes 9:30–18:30 y sábados 11–14.
// No contempla feriados.
export function estaAbierto(fecha) {
  const local = new Date(fecha.getTime() - 3 * 60 * 60 * 1000);
  const dia = local.getUTCDay();
  const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (dia >= 1 && dia <= 5) return minutos >= 570 && minutos < 1110;
  if (dia === 6) return minutos >= 660 && minutos < 840;
  return false;
}

const MOTIVOS = {
  saludo: "Saludo",
  producto: "Consulta de producto",
  sin_resultado: "Consulta de producto",
  pago: "Formas de pago",
  dolar: "Cotización del dólar",
  ubicacion: "Ubicación",
  horario: "Horario",
  garantia: "Garantía",
  canje: "Canje",
  canje_recibido: "Datos de canje",
  pase_informacion: "Pase de información",
  comprar: "Compra",
  humano: "Pide persona",
  cierre: "Agradecimiento",
  error: "Error del servicio",
  llegada: "Llegada al local",
  pide_modelo: "Consulta de producto",
  reparacion: "Reparación",
};

// Si pidió un producto que no está (o no en esa variante), etiqueta "Avisar" y guarda qué buscó.
async function etiquetarAvisar(contacto, respuesta, registro) {
  if (!contacto || !hayManychat() || !registro || registro.stock === "Sí") return;
  try {
    await Promise.race([
      Promise.all([
        ponerEtiqueta(contacto, "Avisar"),
        guardarCampo(contacto, "bot_avisar", registro.modelo),
      ]),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch (e) {
    console.error("bot-consulta avisar error:", e);
  }
}

// Guarda una fila por consulta en la planilla, mediante el Apps Script publicado en
// BOT_LOG_URL. No guarda el número del cliente. Si falla o tarda más de 3 segundos,
// el cliente igual recibe su respuesta.
async function registrarConsulta(respuesta, registro, mensaje) {
  if (!process.env.BOT_LOG_URL) return;
  try {
    await Promise.race([
      escribirRegistro(respuesta, registro, mensaje),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch (e) {
    console.error("bot-consulta registro error:", e);
  }
}

async function escribirRegistro(respuesta, registro, mensaje) {
  const noEntendido = respuesta.tipo === "sin_resultado" && !registro && respuesta.enviar !== "no";
  const motivo = respuesta.enviar === "no"
    ? "Sin texto o repetido"
    : noEntendido ? "No entendido" : MOTIVOS[respuesta.tipo] || "Otro";
  const fila = [
    ...fechaHoraArgentina(new Date()),
    motivo,
    registro?.modelo || "",
    registro?.stock || "",
    respuesta.deriva === "si" ? "Sí" : "No",
    respuesta.abierto === "si" ? "Abierto" : "Cerrado",
    noEntendido ? textoSeguro(mensaje.slice(0, 120)) : "",
  ];
  const r = await fetch(process.env.BOT_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ fila }),
  });
  if (!r.ok) throw new Error(`El registro respondió ${r.status}`);
}

// Evita que un mensaje del cliente se interprete como fórmula en la planilla.
function textoSeguro(texto) {
  return /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
}

// Devuelve fecha y hora como números de planilla, en horario de Argentina (UTC-3).
export function fechaHoraArgentina(fecha) {
  const local = fecha.getTime() - 3 * 60 * 60 * 1000;
  const dias = local / 86400000 + 25569;
  const fechaPlanilla = Math.floor(dias);
  return [fechaPlanilla, Number((dias - fechaPlanilla).toFixed(6))];
}
