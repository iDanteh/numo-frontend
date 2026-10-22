/**
 * Sistema de Lealtad (phone-as-card) — interfaces que reflejan los nombres de
 * campo REALES del backend (ver design.md "Data Model" y
 * `numo-backend/src/shared/models/postgres/{LoyaltyCard,LoyaltyPointsLedger,
 * LoyaltyTierHistory,LoyaltyAdjustmentReason}.js`). El teléfono de 10 dígitos
 * ES la identidad de la tarjeta — no existe `numeroTarjeta` (D1).
 */

export type LoyaltyNivel = 'Bronce' | 'Plata' | 'Oro';

export type LoyaltyMovimientoTipo = 'ACUMULACION' | 'CANJE' | 'AJUSTE' | 'MIGRACION';

export type LoyaltySignoPermitido = 'POSITIVO' | 'NEGATIVO' | 'AMBOS';

export interface LoyaltyCard {
  id: number;
  telefono: string;
  nombre: string;
  nivel: LoyaltyNivel;
  saldoPuntos: number;
  activa: boolean;
  createdById?: string | null;
  createdByNombre?: string | null;
  updatedById?: string | null;
  updatedByNombre?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LoyaltyMovimiento {
  id: number;
  cardId: number;
  tipo: LoyaltyMovimientoTipo;
  puntos: number;
  saldoResultante: number;
  montoVenta: number | null;
  // Total de la venta en Kore (CON impuesto, 2026-10-21) — solo auditoría,
  // nunca se muestra en la UI. El cálculo de puntos usa montoVenta (subtotal).
  montoVentaTotal?: number | null;
  porcentajeAplicado: number | null;
  nivelAplicado: LoyaltyNivel | null;
  promocionNombre?: string | null;
  promocionPorcentaje?: number | null;
  centroCostoId: number | null;
  reasonId: number | null;
  justificacion: string | null;
  origen: string;
  referenciaExterna: string | null;
  usuarioId: string | null;
  usuarioNombre: string | null;
  createdAt: string;
}

export interface LoyaltyTierHistoryEntry {
  id: number;
  cardId: number;
  nivelAnterior: LoyaltyNivel;
  nivelNuevo: LoyaltyNivel;
  motivo: string | null;
  usuarioId: string | null;
  usuarioNombre: string | null;
  at: string;
}

export interface LoyaltyAdjustmentReason {
  id: number;
  clave: string;
  nombre: string;
  signoPermitido: LoyaltySignoPermitido;
  activo: boolean;
  /** % de cálculo automático (0 < n ≤ 100, hasta 2 decimales) — null/undefined
   *  cuando el motivo es manual (puntos tipeados a mano, comportamiento de
   *  siempre). Un motivo con porcentaje configurado no puede tener
   *  signoPermitido:'AMBOS' (el backend rechaza con 400; el frontend valida
   *  lo mismo antes de enviar, ver lealtad-config.component.ts). Opcional
   *  (en vez de requerido) para no forzar a tocar fixtures de otros specs
   *  (ej. tarjeta-detail.component.spec.ts, fuera de alcance de esta tarea)
   *  que construyen este tipo sin este campo. */
  porcentaje?: number | null;
}

export interface LoyaltySucursal {
  id: number;
  clave: string;
  sucursal: string;
  participaLealtad: boolean;
  permiteCanjeLealtad: boolean;
  /** Serie de facturación real de esa sucursal en Kore (2026-10-19, pedido explícito del
   *  usuario) — se muestra como "Sucursal (Serie)", ej. "CEDIS (A0)". Sin uso todavía en
   *  ninguna regla de Lealtad, pero valioso de cara a una regla futura. */
  serieFacturacion: string | null;
}

export interface LoyaltyPorcentajes {
  Bronce: number | null;
  Plata: number | null;
  Oro: number | null;
}

export type LoyaltyCardSortColumn = 'telefono' | 'nombre' | 'nivel' | 'saldo' | 'activa';
export type LoyaltySortDir = 'ASC' | 'DESC';

export interface LoyaltyCardListFilter {
  search?: string;
  nivel?: LoyaltyNivel | '';
  activa?: boolean | '';
  page?: number;
  limit?: number;
  sort?: LoyaltyCardSortColumn;
  sortDir?: LoyaltySortDir;
}

// Bug real 2026-10-19: estos dos tipos describían un contrato {data,pagination} que el backend
// NUNCA implementó — loyalty-card.service.js#listar/listarMovimientos siempre devolvió
// {total,page,limit,pages,cards|movimientos} (mismo criterio que el resto de listados paginados
// de este backend). El mismatch nunca tronaba (TypeScript no valida shapes en runtime) — solo
// dejaba `cards`/`movimientos` en `undefined` en silencio, así que la lista de Tarjetas y el tab
// de movimientos del detalle se veían vacíos sin ningún error. Corregido para reflejar la
// respuesta real.
export interface LoyaltyCardListResult {
  cards: LoyaltyCard[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface LoyaltyMovimientoListResult {
  movimientos: LoyaltyMovimiento[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface LoyaltyCrearTarjetaPayload {
  telefono: string;
  nombre: string;
  nivel?: LoyaltyNivel;
}

export interface LoyaltyCrearTarjetaResult {
  card: LoyaltyCard;
  nip: string;
}

export interface LoyaltyEditarTarjetaPayload {
  nombre?: string;
  telefono?: string;
  activa?: boolean;
}

export interface LoyaltyCambiarNipResult {
  nip: string;
}

export interface LoyaltyAcumulacionPayload {
  // Serie-Folio real de la venta en Kore (ej. "A0-260605320") — reemplaza el
  // select manual de sucursal Y el monto de venta manual (2026-10-21): el
  // backend resuelve la serie ("A0") contra CentroCosto.serieFacturacion,
  // consulta la CxC real en Kore y calcula los puntos sobre su subtotal (el
  // cajero ya no captura ningún importe con libertad total). El folio
  // completo se guarda como referenciaExterna (llave de idempotencia: el
  // mismo folio no puede generar puntos dos veces).
  serieFolio: string;
}

export interface LoyaltyCanjePayload {
  puntos: number;
  // Serie de la sucursal (ej. "A0", 2026-10-21) — reemplaza el select manual:
  // el backend la resuelve contra CentroCosto.serieFacturacion.
  serie: string;
}

export interface LoyaltyAjustePayload {
  // Ambos opcionales — el caller manda uno u otro según si el motivo elegido
  // tiene `porcentaje` configurado (montoBase, el backend calcula los puntos)
  // o no (puntos manual, comportamiento de siempre).
  puntos?: number;
  montoBase?: number;
  reasonId: number;
  justificacion: string;
}

export interface LoyaltyMovimientoResult {
  movimiento: LoyaltyMovimiento;
  saldoPuntos: number;
}

// ── PR7: Config UI (tier %, reasons CRUD, sucursal flags) ───────────────────

export interface LoyaltyGuardarPorcentajesPayload {
  Bronce?: number;
  Plata?: number;
  Oro?: number;
}

export interface LoyaltyCrearReasonPayload {
  clave: string;
  nombre: string;
  signoPermitido: LoyaltySignoPermitido;
  porcentaje?: number | null;
}

export interface LoyaltyEditarReasonPayload {
  nombre?: string;
  signoPermitido?: LoyaltySignoPermitido;
  activo?: boolean;
  /** `null` quita el % y vuelve el motivo manual (PATCH únicamente). */
  porcentaje?: number | null;
}

// ── Catálogo de Promociones (ej. "Buen Fin") — % de bono que se suma
// automáticamente al % del nivel al registrar una ACUMULACION dentro del
// periodo vigente (fechaInicio/fechaFin, 'YYYY-MM-DD'). Esto ya pasa solo en
// el backend — el frontend solo necesita el CRUD de administración acá.
export interface LoyaltyPromotion {
  id: number;
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  porcentajeBono: number;
  activa: boolean;
}

export interface LoyaltyCrearPromocionPayload {
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  porcentajeBono: number;
}

export interface LoyaltyEditarPromocionPayload {
  nombre?: string;
  fechaInicio?: string;
  fechaFin?: string;
  porcentajeBono?: number;
  activa?: boolean;
}

export interface LoyaltyActualizarSucursalPayload {
  participaLealtad?: boolean;
  permiteCanjeLealtad?: boolean;
}

// ── PR7: Public lookup (POST /api/loyalty/public/consulta, D8: never recent
// activity in the response — spec loyalty-public-lookup "Minimal Response
// Payload", confirmed with the user 2026-10-15) ─────────────────────────────

export interface LoyaltyConsultaPublicaResult {
  nombre: string;
  nivel: LoyaltyNivel;
  saldoPuntos: number;
}

// ── Recuperación de NIP en 2 pasos (POST /api/loyalty/public/recuperacion/*,
// mismo router público/anónimo que /consulta) ───────────────────────────────

export interface LoyaltySolicitarCodigoResult {
  mensaje: string;
  /** SIMULACIÓN TEMPORAL — solo presente fuera de producción, mientras no haya
   *  un proveedor de mensajería real conectado (ver loyalty-recovery.service.js). */
  codigoDev?: string;
}

export interface LoyaltyConfirmarCodigoResult {
  nip: string;
}

// ── Migración de clientes legados ("Club Tuberos") — POST
// /api/loyalty/import/concentrado (loyalty:importar, admin-only). SOLO lectura:
// cruza clientes.csv x puntos.pdf y devuelve un reporte de revisión, sin tocar
// la base de datos. Aplicar la migración queda fuera de alcance (ver
// numo-backend/src/loyalty/domains/import/loyalty-import.service.js).
export interface LoyaltyImportResumen {
  totalClientes: number;
  totalConSaldo: number;
  totalSinSaldo: number;
  totalHuerfanosEnPuntos: number;
  totalDuplicadosEnClientes: number;
  totalPosiblesPrueba: number;
  totalNivelPorDefault: number;
  totalSinContacto: number;
}

export interface LoyaltyImportFila {
  tarjetaNormalizada: string;
  tarjetaRawClientes: string | null;
  tarjetaRawPuntos: string | null;
  nombre: string;
  celular: string;
  telefono: string;
  /** Informativo — para contactar clientes que queden pendientes (sin teléfono). */
  correo: string;
  /** Celular si existe, si no Telefono — el dato que se usaría como identidad de tarjeta. */
  contacto: string;
  saldo: number;
  categoriaOriginal: string | null;
  /** Bronce/Plata/Oro si Categoria matchea, Bronce por default si no (ver info 'nivel_asignado_por_default'). */
  nivelSugerido: LoyaltyNivel;
  advertencias: string[];
  info: string[];
}

export interface LoyaltyImportConcentrado {
  resumen: LoyaltyImportResumen;
  filas: LoyaltyImportFila[];
}

// ── Aplicar la migración (POST /api/loyalty/import/aplicar) ─────────────────
// Decisión de negocio 2026-10-19: clientes sin ningún teléfono ya no se
// descartan — quedan en loyalty_pending_enrollments (ver clientes-pendientes/).

export type LoyaltyImportCategoria =
  | 'ok'
  | 'pendiente_sin_telefono'
  | 'ya_migrada'
  | 'duplicado_bloqueante'
  | 'invalido_bloqueante'
  | 'conflicto_bloqueante'
  // Caso real 2026-10-19: dos Tarjetas legadas DISTINTAS comparten el MISMO teléfono — no lo
  // detecta 'duplicado_bloqueante' (agrupa por Tarjeta, no por teléfono). Sin esto, ambas
  // filas clasificaban 'ok' y la segunda reventaba el UNIQUE constraint recién al aplicar.
  | 'telefono_duplicado_bloqueante';

export interface LoyaltyImportFilaClasificada extends LoyaltyImportFila {
  categoria: LoyaltyImportCategoria;
  telefonoNormalizado: string | null;
}

export interface LoyaltyImportClasificacionResumen {
  ok: number;
  pendienteSinTelefono: number;
  yaMigrada: number;
  duplicadoBloqueante: number;
  invalidoBloqueante: number;
  conflictoBloqueante: number;
  telefonoDuplicadoBloqueante: number;
}

export interface LoyaltyImportClasificacion {
  resumen: LoyaltyImportResumen;
  filas: LoyaltyImportFilaClasificada[];
  clasificacionResumen: LoyaltyImportClasificacionResumen;
}

export interface LoyaltyImportAplicarResult {
  clasificacionResumen: LoyaltyImportClasificacionResumen;
  creadas: Array<{ telefono: string; nip: string; mensaje: string }>;
  pendientesCreadas: number;
  omitidasYaMigradas: number;
  /** Decisión de negocio 2026-10-19: las filas bloqueantes (duplicado/invalido/conflicto) ya NO
   *  abortan la corrida — simplemente quedan excluidas (ni se escriben ni cuentan como creadas).
   *  El admin las corrige en el Excel exportado (descargarBloqueantes()) y las re-sube vía
   *  POST /loyalty/import/correcciones (ver clasificarCorrecciones()/aplicarCorrecciones()). */
  excluidasBloqueantes: number;
  /** Decisión de negocio 2026-10-19: una fila que falla al escribir (ej. carrera de teléfono
   *  duplicado no detectada antes) NUNCA detiene el job — se registra acá y se sigue con las
   *  demás. Vacío en el camino feliz. */
  erroresFilas: Array<{ telefono: string | null; nombre: string; error: string }>;
}

// ── Correcciones (re-subida del Excel de filas bloqueantes ya corregidas a mano,
// POST /api/loyalty/import/correcciones) — flujo independiente del par clientes.csv/puntos.pdf.
// Sin `resumen` de tipo concentrado (ese concepto es específico del cruce de dos archivos
// fuente) — solo la clasificación de las filas del Excel de correcciones.
export interface LoyaltyImportCorreccionClasificacion {
  filas: LoyaltyImportFilaClasificada[];
  clasificacionResumen: LoyaltyImportClasificacionResumen;
}

/** POST /loyalty/import/aplicar?confirmar=true (2026-10-19) responde esto de inmediato —
 *  mismo criterio que NetpayUploadJobIniciado: migrar ~9,633 filas (cada una hashea un NIP
 *  con bcrypt) tarda ~22min y ya no cabe en una sola request/transacción, se parte en lotes
 *  de 200 filas (cada lote su propia transacción). El resultado final
 *  (LoyaltyImportAplicarResult) llega por socket — ver lealtadApplyDone$ en socket.service.ts. */
export interface LoyaltyImportAplicarJobIniciado {
  jobId: string;
  total: number;
  totalLotes: number;
}

// ── Registros pendientes de teléfono (GET /api/loyalty/import/pendientes,
// POST /api/loyalty/import/pendientes/:id/completar) ─────────────────────────

export interface LoyaltyPendingEnrollment {
  id: number;
  nombre: string;
  correo: string | null;
  tarjetaLegada: string | null;
  saldoLegado: number;
  nivelSugerido: LoyaltyNivel;
  // 'rechazado' (2026-10-19): el admin decidió que este cliente legado ya no se va a migrar.
  estado: 'pendiente' | 'completado' | 'rechazado';
  cardIdResultante?: number | null;
  resueltoPorNombre?: string | null;
  resueltoAt?: string | null;
  createdAt?: string;
}

export interface LoyaltyPendingEnrollmentListResult {
  total: number;
  page: number;
  limit: number;
  pages: number;
  pendientes: LoyaltyPendingEnrollment[];
}

export interface LoyaltyCompletarPendienteResult {
  card: LoyaltyCard;
  nip: string;
}
