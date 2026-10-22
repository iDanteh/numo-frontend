// Formato de teléfono único para todo el módulo Lealtad (10 dígitos, sin
// espacios/guiones) — usado en alta de tarjeta, corrección de clientes
// pendientes y consulta pública.
export const TELEFONO_RE = /^\d{10}$/;

// Serie-Folio de Kore (ej. "A0-260605320") — usado en ACUMULACION para
// resolver la sucursal sin un select manual (movimiento-modal). Debe calzar
// EXACTO con SERIE_FOLIO_RE en loyalty-ledger.service.js (backend): esta
// copia es solo para feedback inmediato en el form, el backend siempre
// vuelve a validar.
export const SERIE_FOLIO_RE = /^[A-Za-z0-9]{1,10}-\d{1,20}$/;

// Solo la serie (ej. "A0", sin folio) — usada en CANJE para resolver la
// sucursal sin un select manual. Debe calzar EXACTO con SERIE_RE en
// loyalty-ledger.service.js (backend).
export const SERIE_RE = /^[A-Za-z0-9]{1,10}$/;

// Mensaje de error fallback compartido entre tarjetas-list y tarjeta-detail
// para el flujo "Cambiar NIP" (POST /loyalty/cards/:id/nip) — mismo endpoint,
// mismo texto si el backend no manda error.error.
export const NIP_ERROR_FALLBACK = 'No se pudo generar el nuevo NIP.';

// app-confirm-modal bindea [msg] con [innerHTML] — cualquier dato de texto
// libre (nombre de cliente, viene de alta manual o importación CSV) debe
// escaparse antes de concatenarlo en el mensaje, o un valor como
// "<a href=...>" se renderizaría como markup real dentro del modal.
export function escapeHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
