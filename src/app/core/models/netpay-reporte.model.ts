import {
  NetpayEstatusMatch, NetpayMotivoDiscrepancia, NetpayPersona, NetpayCandidatoMovimiento,
} from './netpay-transaccion.model';

/**
 * Netpay: carga manual del reporte como fuente de verdad (ver numo-backend
 * NetpayReporte.model.js / netpay-reporte.service.js). Coexiste con el matching
 * automático (netpay-panel / netpay-evaluacion.service.js) — NO lo reemplaza. El
 * endpoint de Kore reporta una comisión con tasa FIJA por tipo de tarjeta en vez de
 * la tasa real negociada por almacén (evidencia real: hasta 2.36x de sobrecobro), así
 * que el matching automático falla sistemáticamente para esos almacenes — acá se
 * carga el Excel real de Netpay para conciliar manualmente.
 *
 * netpay-matching-v2: mismo enum de 6 estados que NetpayMatch.estatusMatch — un
 * reporte SIEMPRE representa un depósito completo, así que en la práctica nunca toma
 * 'pendiente_por_marca', pero el enum se mantiene idéntico entre ambas colecciones a
 * propósito. Reemplaza el viejo ['pendiente','confirmado','descartado'].
 */
export type NetpayReporteEstatus = NetpayEstatusMatch;
export type NetpayReporteMotivoDiscrepancia = NetpayMotivoDiscrepancia;

/** 'erp-link' cuando el reporte creó el link NETPAYRPT- directamente; 'corroborado'
 * cuando solo confirmó un bucket ya confirmado_automatico con el mismo monto, sin
 * crear un link nuevo. */
export type NetpayReporteVinculo = 'erp-link' | 'corroborado' | null;

export interface NetpayReporteResumenVentas {
  montoTransaccionado: number | null;
  comisiones:          number | null;
  iva:                 number | null;
  montoDepositado:     number | null;
}

/**
 * cuenta viaja tal cual la devuelve Kore (PascalCase, sin remapear — ver
 * netpay-reporte.service.js#consultarFolioKore), puramente informativa.
 */
export interface NetpayReporteKoreCache {
  consultadoEn: string | null;
  cuenta: Record<string, unknown> | null;
}

export interface NetpayReporteFolio {
  // Bug real 2026-09-25: `referencia` (el folio de Netpay, ej. "F20260924-00004")
  // viene NULL cuando el reporte real no la trae para esa transacción — no es
  // hipotético, pasó en producción con un depósito real. Nunca usar `referencia`
  // como clave de identidad de UI (varios folios sin referencia colisionarían
  // entre sí) — `_id` (subdocumento de Mongo, siempre presente) es la clave
  // estable. Ver netpay-reporte-panel.component.ts#folioKey.
  _id?:               string;
  referencia:         string | null;
  terminalID:         string | null;
  storeId:            string | null;
  sucursal:           string | null;
  nombreEmpresa:      string | null;
  fechaTrx:           string | null;
  horaTrx:            string | null;
  montoTrx:           number | null;
  comisionBasePct:    number | null;
  comisionBaseMonto:  number | null;
  ivaComision:        number | null;
  comisionMasIva:     number | null;
  montoDeposito:      number | null;
  banco:              string | null;
  tipoTarjeta:        string | null;
  codigoAutorizacion: string | null;
  orderId:            string | null;
  /** v2: columna "Marca" (AD) — opcional, null si el reporte no la trae. */
  marca:              string | null;
  /** v2: seteado cuando este folio ya estaba registrado por OTRO reporte (idempotencia). */
  duplicadoDeReporteId: string | null;
  koreCache?:         NetpayReporteKoreCache | null;
}

export interface NetpayReportePersona extends NetpayPersona {}

export interface NetpayReporte {
  _id: string;
  claveRastreo: string;
  cuentaDeposito: string | null;
  fechaMovimiento: string;
  periodoDesde: string | null;
  periodoHasta: string | null;
  montoDepositoTotal: number;
  resumenVentas: NetpayReporteResumenVentas;
  folios: NetpayReporteFolio[];
  estatus: NetpayReporteEstatus;
  motivoDiscrepancia: NetpayReporteMotivoDiscrepancia;
  vinculo: NetpayReporteVinculo;
  movementIdConfirmado: string | null;
  confirmadoPor: NetpayReportePersona | null;
  confirmadoEn: string | null;
  descartadoPor: NetpayReportePersona | null;
  descartadoEn: string | null;
  descartadoMotivo: string | null;
  resueltoManualPor: NetpayReportePersona | null;
  resueltoManualEn: string | null;
  justificacion: string | null;
  revertido: { en: string | null; movementIds: string[] } | null;
  estatusLegacy: string | null;
  /** v2 (soft-delete): oculta el reporte de las listas/cierres por default sin borrar nada. */
  eliminado: boolean;
  eliminadoPor: NetpayReportePersona | null;
  eliminadoEn: string | null;
  eliminadoMotivo: string | null;
  cargadoPor: NetpayReportePersona | null;
  cargadoEn: string | null;
  nombreArchivoOriginal: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface NetpayReporteUploadResultado {
  reporte: NetpayReporte;
  candidatos: NetpayCandidatoMovimiento[];
}

export interface NetpayReporteListaResultado {
  reportes: NetpayReporte[];
}

export interface NetpayReporteDetalleResultado {
  reporte: NetpayReporte;
}

export interface NetpayReporteResolverPayload {
  justificacion: string;
  /** El modelo NetpayReporte solo tiene UN campo movementIdConfirmado (a diferencia de
   * NetpayMatch.movementIdsConfirmados[]) — a lo sumo 1 elemento aquí. */
  movementIds?: string[];
}

export interface NetpayReporteResolverResultado {
  reporte: NetpayReporte;
  movimientos: unknown[];
}

export interface NetpayReporteRechazarPayload {
  motivo?: string;
}

export interface NetpayReporteRechazarResultado {
  reporte: NetpayReporte;
}

export interface NetpayReporteEliminarResultado {
  reporte: NetpayReporte;
}

export interface NetpayReporteRestaurarResultado {
  reporte: NetpayReporte;
}

export interface NetpayReporteFolioKoreResultado {
  cuenta: Record<string, unknown>;
  consultadoEn: string;
}
