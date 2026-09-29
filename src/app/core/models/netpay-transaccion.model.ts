/**
 * Netpay — Fase 1: consulta en vivo (sin persistencia) de transacciones vía
 * GET /transactions/search de Kore (ver numo-backend
 * netpay-transacciones.service.js). Filtros manuales por ahora (responseCode,
 * almacenes); más filtros y cualquier matching contra BankMovement quedan para
 * una siguiente iteración.
 */

/** Tal cual viene de Kore — sin remapear nombres de campo. */
export interface NetpayTransaccion {
  ID: number;
  orderID: string;
  transactionID: string;
  cardTypeName: string;
  cardType: string;
  folio: string;
  bank: string;
  amount: number;
  responseCode: string;
  message: string;
  customerName: string;
  terminalID: string;
  ticketDate: string;
  transactionDate: string;
  reprintCount: number;
  status: string;
  userID: string;
  userName: string;
  almacen: string | null;
  idDetalleOperacion: string;
  reprintCancelCount: number;
  formaPagoId: string;
  commission: number | null;
}

/** Valores válidos de Kore para el filtro de estatus (ver NetpayTransaccion.status). */
export type NetpayStatusFiltro = 'completed' | 'canceled' | 'rejected';

export interface NetpayPorAlmacen {
  almacen: string;
  totalMonto: number;
  totalComision: number;
  neto: number;
}

export interface NetpayConsultaResultado {
  transacciones: NetpayTransaccion[];
  totales: { monto: number; comision: number; neto: number };
  porAlmacen: NetpayPorAlmacen[];
}

/**
 * netpay-matching-v2 (ver numo-backend design.md "Data Model" / NetpayMatch.model.js):
 * la unidad de decisión pasa de "grupo terminalID+día, TODO EN VIVO" a un BUCKET
 * persistido (terminalID, dia, bucket) — bucket es 'general' o una marca diferida
 * (ej. 'AMEX'). A diferencia de v1, TODA decisión automática se persiste, incluida
 * discrepancia — esto habilita auditar por qué un bucket quedó sin resolver, y el
 * resolve manual (netpay-resolver.service.js). GET /netpay/bandeja ya NO llama a Kore
 * — solo lee lo ya evaluado por POST /netpay/bandeja/evaluar.
 */
export type NetpayEstatusMatch =
  | 'confirmado_automatico'
  | 'pendiente_por_marca'
  | 'discrepancia'
  | 'resuelto_por_reporte'
  | 'rechazado'
  | 'resuelto_manual';

export type NetpayMotivoDiscrepancia =
  | 'sin_candidato'
  | 'multiples_candidatos'
  | 'candidato_en_conflicto'
  | 'cobertura_parcial'
  | 'revertido'
  | 'reporte_revertido'
  | 'vinculo_huerfano'
  | 'folio_duplicado'
  | null;

export interface NetpayPersona {
  userId: string | null;
  nombre: string | null;
}

export interface NetpaySnapshotFolio {
  orderId: string | null;
  referencia: string | null;
  marca: string | null;
  monto: number | null;
  comision: number | null;
}

export interface NetpayMatchSnapshot {
  terminalID: string | null;
  dia: string | null;
  montoBruto: number | null;
  comision: number | null;
  netoEsperado: number | null;
  folios: NetpaySnapshotFolio[];
  reporteIdOrigen: string | null;
  claveRastreoOrigen: string | null;
  montoDepositoReporte: number | null;
}

/** Un bucket NetpayMatch YA evaluado — ver NetpayMatch.model.js. */
export interface NetpayMatch {
  _id: string;
  terminalID: string;
  almacen: string | null;
  /** ISO datetime, medianoche UTC del día agrupado. */
  dia: string;
  bucket: string;
  netoEsperado: number;
  estatusMatch: NetpayEstatusMatch;
  motivoDiscrepancia: NetpayMotivoDiscrepancia;
  snapshot: NetpayMatchSnapshot | null;
  movementIdsConfirmados: string[];
  confirmadoPor: NetpayPersona | null;
  confirmadoEn: string | null;
  resueltoManualPor: NetpayPersona | null;
  resueltoManualEn: string | null;
  justificacion: string | null;
  descartadoManualmentePor: NetpayPersona | null;
  descartadoManualmenteEn: string | null;
  rechazoMotivo: string | null;
  revertido: { en: string | null; movementIds: string[] } | null;
  estatusLegacy: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface NetpayBandejaResultado {
  buckets: NetpayMatch[];
}

export interface NetpayEvaluarPayload {
  dateFrom?: string;
  dateTo?: string;
  terminalID?: string;
}

export interface NetpayEvaluarResultado {
  evaluados: NetpayMatch[];
}

export interface NetpayResolverPayload {
  justificacion: string;
  movementIds?: string[];
}

export interface NetpayResolverResultado {
  bucket: NetpayMatch;
  movimientos: unknown[];
}

export interface NetpayRechazarPayload {
  motivo?: string;
}

export interface NetpayRechazarResultado {
  bucket: NetpayMatch;
}

/**
 * Shape reducido del BankMovement candidato (ver netpay-resolver.service.js#candidatos /
 * netpay-reporte.service.js#_buscarCandidatosParaReporte/_buscarCandidatosEnVentana).
 * `diferencia` solo viaja en modo "ventana" (todos los elegibles, ordenados por |diff|,
 * exclusivo del diálogo de resolver manual) — en el modo default (montos exactos) no viene.
 */
export interface NetpayCandidatoMovimiento {
  _id: string;
  banco: string;
  fecha: string;
  concepto: string | null;
  deposito: number | null;
  numeroAutorizacion: string | null;
  diferencia?: number;
}

export interface NetpayCandidatosResultado {
  candidatos: NetpayCandidatoMovimiento[];
}
