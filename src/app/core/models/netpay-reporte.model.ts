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

/** Resumen liviano (banco/fecha/monto) del BankMovement vinculado — poblado por el
 * backend (netpay-reporte.service.js#_poblarMovimientoVinculado) en todos los endpoints
 * que devuelven un reporte individual, para mostrarlo en el detalle sin navegar a Bancos
 * primero. null si no hay movementIdConfirmado, o si ese movimiento ya no existe. */
export interface NetpayReporteMovimientoVinculado {
  banco: string;
  fecha: string;
  monto: number;
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
  motivoDiscrepancia: NetpayReporteMotivoDiscrepancia;
  vinculo: NetpayReporteVinculo;
  movementIdConfirmado: string | null;
  movimientoVinculado: NetpayReporteMovimientoVinculado | null;
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

/**
 * netpay-reporte-global: un solo archivo Netpay puede traer N depósitos (hoja "Resumen"
 * con varias filas) — cada uno se procesa de forma independiente del lado del backend
 * (ver netpay-reporte.service.js#_procesarDeposito/cargarReporte). `estatusCarga` es
 * DISTINTO de `reporte.estatus`: el primero describe el resultado de la CARGA de este
 * depósito en este archivo (se creó / ya existía / falló), el segundo es el resultado de
 * evaluarReporte() (matching automático) — solo presente cuando `estatusCarga==='creado'`.
 */
export type NetpayReporteCargaEstatus = 'creado' | 'ya_cargado' | 'error';

export interface NetpayReporteCargaItem {
  claveRastreo: string;
  fechaMovimiento: string;
  montoDepositoTotal: number;
  /** Valores únicos no nulos derivados de los folios de este depósito. */
  sucursales: string[];
  terminalIDs: string[];
  estatusCarga: NetpayReporteCargaEstatus;
  /** Solo presente cuando estatusCarga==='creado' — el reporte recién creado y evaluado. */
  reporte?: NetpayReporte;
  candidatos?: NetpayCandidatoMovimiento[];
  /** Solo presente cuando estatusCarga==='ya_cargado' — el _id del NetpayReporte existente. */
  reporteId?: string;
  /** Solo presente cuando estatusCarga==='error' — mensaje de por qué falló ESTE depósito. */
  error?: string;
}

export interface NetpayReporteUploadResumen {
  total: number;
  creados: number;
  yaCargados: number;
  errores: number;
}

export interface NetpayReporteUploadResultado {
  reportes: NetpayReporteCargaItem[];
  resumen: NetpayReporteUploadResumen;
  /** Compatibilidad hacia atrás: solo presentes cuando N===1 && creado (ver design.md
   * "Backward compat") — los consumidores existentes (ej. subir() con un solo depósito)
   * siguen funcionando sin cambios. Para N>1 o cualquier otro caso, usar `reportes[]`. */
  reporte?: NetpayReporte;
  candidatos?: NetpayCandidatoMovimiento[];
}

/**
 * POST /netpay/reporte/:id/reevaluar — re-dispara evaluarReporte() para UN reporte ya
 * persistido (botón "Reevaluar" del detalle). A diferencia de NetpayReporteUploadResultado
 * (que ahora puede cubrir N depósitos de un archivo), este endpoint siempre opera sobre un
 * único reporte existente, así que mantiene la forma simple de siempre (nunca `reportes[]`).
 */
export interface NetpayReporteReevaluarResultado {
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
