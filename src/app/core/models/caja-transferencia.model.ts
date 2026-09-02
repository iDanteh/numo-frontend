/**
 * Transferencias entre cajas (sucursal → gerente) — Fase A-D del proceso de
 * matching contra Depósito en efectivo huérfanos (ver numo-backend
 * CajaTransferencia.model.js / caja-transferencia-*.service.js).
 */

export type CajaTransferenciaEstatusMatch = 'pendiente' | 'matcheada' | 'huerfana';

export interface CajaTransferencia {
  _id: string;
  koreId: string;
  monto: number;
  estatusKore: string | null;
  cajaOrigenId: string | null;
  nombreCajaOrigen: string | null;
  almacenCajaOrigen: string | null;
  cajaDestinoId: string | null;
  nombreCajaDestino: string | null;
  almacenCajaDestino: string | null;
  formaPago: string | null;
  nombreFormaPago: string | null;
  solicito: string | null;
  nombreSolicito: string | null;
  recibio: string | null;
  nombreRecibio: string | null;
  autorizo: string | null;
  nombreAutorizo: string | null;
  fechaSolicitud: string | null;
  fechaRecepcion: string | null;
  observacion: string | null;
  idTipoTransferencia: string | null;
  nombreTipoTransferencia: string | null;
  estatusMatch: CajaTransferenciaEstatusMatch;
  confirmadoPor?: { userId: string | null; nombre: string | null } | null;
  confirmadoEn?: string | null;
  movementIdsConfirmados?: string[];
}

/** Shape reducido del BankMovement candidato — tal cual lo arma buscarCandidatos(). */
export interface CajaTransferenciaCandidatoMovimiento {
  _id: string;
  banco: string;
  fecha: string;
  concepto: string | null;
  deposito: number | null;
  categoria: string | null;
}

export interface CajaTransferenciaPendiente {
  transferencia: CajaTransferencia;
  // Uno o más grupos candidatos — cada grupo es 1 o 2 movimientos cuya suma
  // matchea el monto de la transferencia (ver Fase C, split real por límite de
  // depósito por banco). Puede haber más de un grupo si hay ambigüedad.
  candidatos: CajaTransferenciaCandidatoMovimiento[][];
}

export interface CajaTransferenciaBandeja {
  pendientes: CajaTransferenciaPendiente[];
  huerfanas: CajaTransferencia[];
}
