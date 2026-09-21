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
 * Matching Netpay↔BBVA (ver numo-backend netpay-match.service.js) — Fase C/D. TODO EN
 * VIVO, sin sync/cron: la bandeja se calcula contra Kore en cada request, agrupando por
 * almacen+terminalID+día. Un grupo "pendiente" no tiene ningún id propio en Mongo (solo lo
 * resuelto se persiste, ver NetpayMatch.model.js) — terminalID+dia identifican al grupo
 * tanto para mostrarlo como para confirmar/descartar.
 */
export interface NetpayGrupoPendiente {
  terminalID: string;
  almacen: string | null;
  /** ISO datetime, medianoche UTC del día agrupado. */
  dia: string;
  montoBruto: number;
  comision: number;
  netoEsperado: number;
  cantidadTransacciones: number;
}

/** Shape reducido del BankMovement candidato — tal cual lo arma netpay-match.service.js. */
export interface NetpayCandidatoMovimiento {
  _id: string;
  banco: string;
  fecha: string;
  concepto: string | null;
  deposito: number | null;
  numeroAutorizacion: string | null;
}

export interface NetpayMatchPendiente {
  grupo: NetpayGrupoPendiente;
  // Uno o más grupos candidatos — cada uno 1 o 2 BankMovement (mismo criterio de split que
  // Transferencias entre cajas). Puede haber más de un grupo si hay ambigüedad.
  candidatos: NetpayCandidatoMovimiento[][];
}

export interface NetpayBandejaResultado {
  pendientes: NetpayMatchPendiente[];
}

export interface NetpayConfirmarMatchPayload {
  terminalID: string;
  almacen: string | null;
  dia: string;
  movementIds: string[];
}

export interface NetpayDescartarMatchPayload {
  terminalID: string;
  almacen: string | null;
  dia: string;
}
