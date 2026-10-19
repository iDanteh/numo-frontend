// Formato de teléfono único para todo el módulo Lealtad (10 dígitos, sin
// espacios/guiones) — usado en alta de tarjeta, corrección de clientes
// pendientes y consulta pública.
export const TELEFONO_RE = /^\d{10}$/;

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
