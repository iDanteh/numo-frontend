import { NetpayCandidatoMovimiento } from './netpay-transaccion.model';

/**
 * Netpay: carga manual del reporte como fuente de verdad (Implementación 1, ver
 * numo-backend NetpayReporte.model.js / netpay-reporte.service.js). Coexiste con el
 * matching automático (netpay-panel / netpay-match.service.js) — NO lo reemplaza. El
 * endpoint de Kore reporta una comisión con tasa FIJA por tipo de tarjeta en vez de la tasa
 * real negociada por almacén (evidencia real: hasta 2.36x de sobrecobro), así que el
 * matching automático falla sistemáticamente para esos almacenes — acá se carga el Excel
 * real de Netpay para conciliar manualmente.
 */

export type NetpayReporteEstatus = 'pendiente' | 'confirmado' | 'descartado';

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
  koreCache?:         NetpayReporteKoreCache | null;
}

export interface NetpayReportePersona {
  userId: string | null;
  nombre: string | null;
}

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
  movementIdConfirmado: string | null;
  confirmadoPor: NetpayReportePersona | null;
  confirmadoEn: string | null;
  descartadoPor: NetpayReportePersona | null;
  descartadoEn: string | null;
  descartadoMotivo: string | null;
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

export interface NetpayReporteConfirmarResultado {
  reporte: NetpayReporte;
  movimiento: unknown;
}

export interface NetpayReporteDescartarResultado {
  reporte: NetpayReporte;
}

export interface NetpayReporteFolioKoreResultado {
  cuenta: Record<string, unknown>;
  consultadoEn: string;
}
