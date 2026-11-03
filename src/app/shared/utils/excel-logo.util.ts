/**
 * Logo de marca en reportes Excel (2026-11-03, pedido explícito del usuario) — todos los
 * generadores de Excel de Lealtad (LealtadReportesPanelComponent y el export por tarjeta de
 * TarjetaDetailComponent) insertan `public/tyc-logo.png` arriba a la izquierda de cada hoja.
 *
 * Centralizado acá (en vez de repetir fetch+addImage en cada uno de los 6+ generadores, 2026-11-03
 * pedido explícito del usuario): el PNG se trae UNA sola vez por sesión del navegador — el
 * `fetch()` se cachea en `_logoArrayBuffer` a nivel de módulo, compartido entre ambos componentes.
 * Si el fetch falla (ej. en Karma, donde el asset no se sirve) se resuelve a `null` y el logo
 * simplemente no se inserta — nunca bloquea ni revienta la generación del Excel.
 */

const LOGO_PATH = 'tyc-logo.png';

// Proporción real del archivo (~1572x298, fondo transparente) — se mantiene el aspect ratio al
// dimensionar el logo dentro de la hoja.
const LOGO_WIDTH = 220;
const LOGO_HEIGHT = Math.round(LOGO_WIDTH * (298 / 1572));

let _logoArrayBuffer: Promise<ArrayBuffer | null> | null = null;

function _cargarLogo(): Promise<ArrayBuffer | null> {
  if (!_logoArrayBuffer) {
    _logoArrayBuffer = fetch(LOGO_PATH)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
  }
  return _logoArrayBuffer;
}

/**
 * Inserta el logo en la esquina superior izquierda de `worksheet` (filas/columnas 0-index de
 * ExcelJS). El llamador es responsable de correr el resto del contenido de la hoja hacia abajo
 * (ej. empezar la tabla en la fila 4 o 5) para no pisarlo.
 *
 * `workbook`/`worksheet` son del paquete `exceljs` cargado con `await import('exceljs')` — se
 * tipan como `any` acá para no acoplar este util a esa dependencia pesada en tiempo de compilación
 * (mismo criterio que ya usan los generadores que lo consumen).
 */
export async function insertarLogoExcel(workbook: any, worksheet: any): Promise<void> {
  const buffer = await _cargarLogo();
  if (!buffer) return; // sin logo disponible (ej. Karma) — no bloquea la generación del Excel

  const imageId = workbook.addImage({ buffer, extension: 'png' });
  worksheet.addImage(imageId, {
    tl: { col: 0, row: 0 },
    ext: { width: LOGO_WIDTH, height: LOGO_HEIGHT },
  });
}
