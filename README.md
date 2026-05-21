# Dr.iPhone — Portal de Reventas
## Guía de deploy en 15 minutos

---

## PASO 1 — Preparar el Google Sheet

Creá un nuevo Google Sheet y armá estas 3 hojas con exactamente estos nombres:

### Hoja: `Reventas`
| A: codigo   | B: nombre       | C: activo |
|-------------|-----------------|-----------|
| REVENTA001  | Distribuidora X | SI        |
| REVENTA002  | Juan Pérez      | SI        |
| REVENTA003  | Cuenta vieja    | NO        |

> Para desactivar un reventa sin borrarlo, poné NO en columna C.

---

### Hoja: `Stock_Web`
Copiá desde tu Excel los equipos disponibles con estas columnas:

| A: id    | B: modelo    | C: capacidad | D: color    | E: estado  | F: precio_usd | G: cotizacion | H: estado_stock |
|----------|--------------|--------------|-------------|------------|---------------|----------------|-----------------|
| DRI-001  | iPhone 13    | 128 GB       | Medianoche  | Excelente  | 1100          | 1455           | Disponible      |
| DRI-002  | iPhone 14    | 256 GB       | Negro       | Excelente  | 1600          | 1455           | Disponible      |
| DRI-003  | iPhone 12    | 64 GB        | Rojo        | Bueno      | 750           | 1455           | Vendido         |

> - Solo aparecen en el catálogo las filas con H = **Disponible**
> - Columna G (cotizacion): actualizás UNA sola celda y se replica a todas las filas con una fórmula =G$2
> - Cuando vendés un equipo, cambiás H de "Disponible" a "Vendido" y desaparece del catálogo

---

### Hoja: `CC_Reventas`
Vos cargás los movimientos acá. El reventa solo puede ver, no editar.

| A: codigo  | B: fecha   | C: concepto            | D: tipo  | E: tipo_flujo | F: monto_usd |
|------------|------------|------------------------|----------|---------------|--------------|
| REVENTA001 | 10/04/2026 | iPhone 14 256GB Negro  | venta    | debe          | 1600         |
| REVENTA001 | 12/04/2026 | Pago transferencia     | pago     | haber         | 1000         |
| REVENTA001 | 15/04/2026 | Crédito por devolución | credito  | haber         | 200          |

> **Tipos de movimiento:**
> - `venta` → compra un equipo (debe)
> - `pago` → te paga (haber)
> - `credito` → crédito que le das (haber)
> - `ajuste` → cualquier corrección (puede ser debe o haber)

---

## PASO 2 — Hacer el Sheet público (solo lectura)

1. Abrí el Sheet
2. Archivo → Compartir → "Cualquier usuario con el vínculo puede **ver**"
3. Copiá el ID del Sheet: está en la URL entre `/d/` y `/edit`
   - Ej: `https://docs.google.com/spreadsheets/d/**1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms**/edit`
   - El ID es: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms`

---

## PASO 3 — Obtener Google API Key (gratis)

1. Entrá a https://console.cloud.google.com
2. Creá un proyecto nuevo (o usá uno existente)
3. Activá la API: Buscar "Google Sheets API" → Habilitar
4. Credenciales → Crear credenciales → Clave de API
5. (Opcional pero recomendado) Restringí la clave a: Google Sheets API + tu dominio de Vercel

---

## PASO 4 — Deploy en Vercel

### Opción A: desde GitHub (recomendado)
1. Subí esta carpeta a un repo de GitHub
2. Entrá a https://vercel.com → New Project → importá el repo
3. En "Environment Variables" agregá:
   - `SHEET_ID` = el ID de tu Google Sheet
   - `GOOGLE_API_KEY` = tu API key de Google
4. Deploy → ¡listo!

### Opción B: desde la terminal
```bash
npm i -g vercel
cd driphone-app
vercel
# Seguí las instrucciones, cuando te pida env variables ingresá SHEET_ID y GOOGLE_API_KEY
```

---

## PASO 5 — Configurar el número de WhatsApp

En `public/index.html`, línea ~170, cambiá:
```js
const WA_NUMBER = "5492999000000";
```
Por tu número real con código de país (Argentina = 54, sin el 0 y sin el 15):
- Ejemplo Neuquén: `549299XXXXXXX`

---

## Flujo diario de uso

**Cuando comprás equipos:**
→ Agregás filas en la hoja `Stock_Web` con H = "Disponible"

**Cuando vendés:**
→ Cambiás la columna H a "Vendido" → desaparece del catálogo automáticamente

**Cuando actualizás cotización:**
→ Cambiás la celda G2 en `Stock_Web` → todas las filas se actualizan solas (con fórmula =G$2)

**Cuando el reventa compra:**
→ Agregás una fila en `CC_Reventas` con tipo=venta, tipo_flujo=debe

**Cuando el reventa paga:**
→ Agregás una fila en `CC_Reventas` con tipo=pago, tipo_flujo=haber

---

## Dominio personalizado (opcional)

En Vercel → Settings → Domains → agregás `reventas.driphone.com.ar` o similar.
Requiere acceso al DNS de tu dominio.

---

## Soporte

Ante cualquier duda, los archivos clave son:
- `public/index.html` → toda la app frontend
- `api/auth.js` → verificación de códigos
- `api/stock.js` → lectura del catálogo
- `api/cc.js` → lectura de cuenta corriente
