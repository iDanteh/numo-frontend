export type CFDISource = 'ERP' | 'SAT' | 'MANUAL' | 'RECEPTOR';

export interface CFDIFilter {
  page?: number;
  limit?: number;
  source?: string;
  tipoDeComprobante?: string;
  rfcEmisor?: string;
  rfcReceptor?: string;
  satStatus?: string;
  erpStatus?: string;
  fechaInicio?: string;
  fechaFin?: string;
  search?: string;
  uuid?: string;
  ejercicio?: number;
  periodo?: number;
  lastComparisonStatus?: string;
}
export type TipoComprobante = 'I' | 'E' | 'T' | 'N' | 'P';
export type SatStatus = 'Vigente' | 'Cancelado' | 'Deshabilitado' | 'No Encontrado' | 'Pendiente' | 'Error' | 'Expresión Inválida' | 'Desconocido' | null;
export type ErpStatus = 'Timbrado' | 'Cancelado' | 'Habilitado' | 'Deshabilitado' | 'Cancelacion Pendiente' | null;
export type ComparisonStatus = 'match' | 'discrepancy' | 'warning' | 'not_in_sat' | 'not_in_erp' | 'cancelled' | 'sat_cancelado' | 'pending' | 'error';

export type DiscrepancyType =
  | 'UUID_NOT_FOUND_SAT' | 'AMOUNT_MISMATCH' | 'RFC_MISMATCH' | 'DATE_MISMATCH'
  | 'CANCELLED_IN_SAT' | 'DUPLICATE_UUID' | 'MISSING_IN_ERP' | 'TAX_CALCULATION_ERROR'
  | 'CFDI_VERSION_MISMATCH' | 'SIGNATURE_INVALID' | 'COMPLEMENT_MISSING' | 'REGIME_MISMATCH' | 'OTHER';
export type Severity = 'critical' | 'warning' | 'high' | 'medium' | 'low';
export type DiscrepancyStatus = 'open' | 'in_review' | 'resolved' | 'ignored' | 'escalated';

export interface Contribuyente {
  rfc: string;
  nombre?: string;
  regimenFiscal?: string;
  usoCFDI?: string;
}

export interface DoctoRelacionado {
  idDocumento: string;
  serie?: string;
  folio?: string;
  monedaDR: string;
  tipoCambioDR?: number;
  metodoDePagoDR: string;
  numParcialidad?: number;
  impSaldoAnt?: number;
  impPagado?: number;
  impSaldoInsoluto?: number;
}

export interface PagoDetalle {
  fechaPago: string;
  formaDePagoP: string;
  monedaP: string;
  tipoCambioP?: number;
  monto: number;
  numOperacion?: string;
  doctosRelacionados?: DoctoRelacionado[];
}

export interface CfdiRelacionado {
  tipoRelacion: string;
  uuids: string[];
}

export interface ComplementoPago {
  version: string;
  pagos: PagoDetalle[];
  totales?: {
    montoTotalPagos: number;
  };
}

export interface CFDI {
  _id: string;
  uuid: string;
  source: CFDISource;
  version: string;
  serie?: string;
  folio?: string;
  fecha: Date;
  subTotal: number;
  descuento?: number;
  moneda: string;
  tipoCambio?: number;
  total: number;
  tipoDeComprobante: TipoComprobante;
  formaPago?: string;
  metodoPago?: string;
  lugarExpedicion?: string;
  emisor: Contribuyente;
  receptor: Contribuyente;
  satStatus: SatStatus;
  satLastCheck?: Date;
  erpStatus?: ErpStatus;
  lastComparisonStatus?: ComparisonStatus | null;
  lastComparisonAt?: Date;
  erpId?: string;
  createdAt: Date;
  updatedAt: Date;
  xmlHash?: string;
  ejercicio?: number;
  periodo?: number;
  informacionGlobal?: { periodicidad?: string; mes?: string; anio?: string };
  /** Solo presente en TipoComprobante === 'P' */
  complementoPago?: ComplementoPago;
  cfdiRelacionados?: CfdiRelacionado[];
}

export interface FieldDiff {
  field: string;
  erpValue: unknown;
  satValue: unknown;
  severity: 'critical' | 'warning' | 'info';
  fiscalImpact?: { amount: number; currency: string; taxType?: string };
}

export interface Comparison {
  _id: string;
  uuid: string;
  erpCfdiId: string | Partial<CFDI>;
  satCfdiId?: string | Partial<CFDI>;
  sessionId?: string | null;
  status: ComparisonStatus;
  ejercicio?: number;
  periodo?: number;
  differences: FieldDiff[];
  totalDifferences: number;
  criticalCount: number;
  warningCount: number;
  comparedAt: Date;
  comparedBy: string;
  resolved: boolean;
  resolvedAt?: Date;
  resolutionNotes?: string;
  hasLocalSATCopy?: boolean;
}

export interface ComparisonSession {
  _id: string;
  name: string;
  triggeredBy?: { _id: string; name?: string; email: string };
  status: 'running' | 'completed' | 'failed';
  totalCFDIs: number;
  processed: number;
  failedCount: number;
  results: {
    match: number;
    discrepancy: number;
    not_in_sat: number;
    cancelled: number;
    error: number;
  };
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface Discrepancy {
  _id: string;
  comparisonId: string | Partial<Comparison>;
  uuid: string;
  type: DiscrepancyType;
  ejercicio?: number;
  periodo?: number;
  severity: Severity;
  description: string;
  erpValue?: unknown;
  satValue?: unknown;
  rfcEmisor?: string;
  rfcReceptor?: string;
  status: DiscrepancyStatus;
  satStatus?: string;
  fiscalImpact?: { amount: number; currency: string; taxType?: string };
  createdAt: Date;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

export interface IvaStatsFuente {
  ivaTrasladadoTotal: number;
  ivaRetenidoTotal:   number;
  ivaNeto:            number;
}

export interface IvaStatsFuenteConConteo extends IvaStatsFuente {
  count: number;
}

export interface IvaStatsTipo {
  erp?: IvaStatsFuenteConConteo;
  sat?: IvaStatsFuenteConConteo;
}

export interface IvaStats extends IvaStatsFuente {
  erp: IvaStatsFuente;
  sat: IvaStatsFuente;
  byTipo?: Record<string, IvaStatsTipo>;
}

export interface DiscrepanciaMonto {
  _id: string;
  uuid: string;
  status: ComparisonStatus;
  criticalCount: number;
  warningCount: number;
  tipoDeComprobante?: TipoComprobante;
  ejercicio?: number;
  periodo?: number;
  comparedAt: Date;
  differences: FieldDiff[];
  erpCfdiId?: Partial<CFDI>;
  satCfdiId?: Partial<CFDI>;
}

export interface DiscrepanciaMontosResponse {
  items: DiscrepanciaMonto[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface CfdiStatusMismatch {
  _id: string;
  uuid: string;
  serie?: string;
  folio?: string;
  fecha: Date;
  total: number;
  tipoDeComprobante: TipoComprobante;
  emisor: Contribuyente;
  receptor: Contribuyente;
  satStatus: SatStatus;
  erpStatus: ErpStatus;
}

export interface CfdiStatusMismatchResponse {
  items: CfdiStatusMismatch[];
  total: number;
}

export interface PagosRelacionadosStats {
  totalPagos: number;
  totalDoctos: number;
  existenEnSistema: number;
  noExistenEnSistema: number;
  porcentajeCobertura: number;
}

export interface DashboardKPIs {
  totalCFDIs: number;
  conciliados: number;
  vigenteErpSat: { count: number; total: number };
  conDiscrepancia: number;
  sinConciliar: number;
  notInErp: number;
  erpCanceladosCount: number;
  erpCancelados?: { total: number; count: number };
  satCancelados?: { total: number; count: number };
  totalERP: number;
  totalSAT: number;
  diferencia: number;
  countERP: number;
  countSAT: number;
  cfdisBySatStatus: Array<{ _id: SatStatus; count: number; totalAmount: number }>;
  comparisonStats: Array<{ _id: ComparisonStatus; count: number }>;
  discrepancyStats: Array<{ _id: Severity; count: number; fiscalImpact: number }>;
  ivaStats: IvaStats;
}
