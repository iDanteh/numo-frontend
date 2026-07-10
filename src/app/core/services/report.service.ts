import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface PagosBancoFiltros {
  uuid?:            string;
  serie?:           string;
  folio?:           string;
  banco?:           string;
  numAutorizacion?: string;
  idNumo?:          string;
  serieCxc?:        string;
  folioCxc?:        string;
  fechaInicio?:     string;
  fechaFin?:        string;
  ejercicio?:       number;
  periodo?:         number;
  estado?:          'todos' | 'con_pago' | 'sin_pago';
  page?:            number;
  limit?:           number;
}

export interface PagoBancoRow {
  cfdiUuid:         string;
  satStatus:        string;
  source:           string;
  fechaPago:        string;
  montoPago:        number;
  facturaUuid:      string;
  serie:            string;
  folio:            string;
  numParcialidad:   number;
  impPagado:        number;
  impSaldoAnt: number | null;
  impSaldoInsoluto: number;
  tienePago:    boolean;
  banco:        string | null;
  movFecha:     string | null;
  movFolio:     string | null;
  deposito:     number | null;
  movConcepto:      string | null;
  numOperacion:     string | null;
  diferencia:       number;
  saldoMovimiento:  number | null;
  identificadoPor:  string | null;
}

export interface PagosBancoResumen {
  conPago: { cantidad: number; monto: number };
  sinPago: { cantidad: number; monto: number };
}

export interface PagosBancoResponse {
  data:    PagoBancoRow[];
  total:   number;
  page:    number;
  limit:   number;
  pages:   number;
  resumen: PagosBancoResumen;
}

export interface Parcialidad {
  serie:            string;
  folio:            string;
  fecha:            string;
  numParcialidad:   number;
  impSaldoAnt: number | null;
  impPagado:        number;
  impSaldoInsoluto: number;
}

export interface EgresoRelacionado {
  uuid:      string;
  satStatus: string | null;
  serie:     string | null;
  folio:     string | null;
  fecha:     string | null;
  total:     number | null;
  tipo:      string; // 'Bonificación Club Tuberos' | 'Bonificación' | 'Devolución' | 'Cargo a Cliente' | 'Nota de Crédito'
}

export interface PagosBancoDetalle {
  factura: {
    uuid: string;
    satStatus: string;
    serie: string;
    folio: string;
    total: number;
    fecha: string;
    receptor?: { rfc: string; nombre?: string } | null;
  } | null;
  parcialidades: Parcialidad[];
  cuentasPorCobrar: CuentaPorCobrarAfectada[];
  egresosRelacionados: EgresoRelacionado[];
  // true si la factura es Global (receptor Público en General / nodo InformacionGlobal).
  // En ese caso el backend NO cruza por monto CxC↔Notas de Crédito (no es confiable).
  facturaEsGlobal: boolean;
  movimientos: {
    banco: string;
    fecha: string;
    deposito: number;
    retiro: number;
    folio: string;
    concepto: string;
    status: string;
    numeroAutorizacion: string | null;
    referenciaNumerica: string | null;
    erpLinks: {
      erpId:          string;
      folioFiscal:    string | null;
      folioExterno:   string | null;
      serie:          string | null;
      saldoActual:    number;
      total:          number | null;
      tieneRetencion: boolean;
    }[];
  }[];
}

export interface DepositosIngresosFiltros {
  uuid?:            string;
  serie?:           string;
  folio?:           string;
  banco?:           string;
  numAutorizacion?: string;
  idNumo?:          string;
  serieCxc?:        string;
  folioCxc?:        string;
  fechaInicio?:     string;
  fechaFin?:        string;
  ejercicio?:       number;
  periodo?:         number;
  tipoVenta?:       'todos' | 'contado' | 'credito';
  tieneDeposito?:   'todos' | 'con_deposito' | 'sin_deposito';
  page?:            number;
  limit?:           number;
}

export interface DepositoIngresoRow {
  cfdiUuid:        string;
  satStatus:       string;
  tipoVenta:       'Contado' | 'Credito';
  serie:           string;
  folio:           string;
  fecha:           string;
  total:           number;
  tienePago:       boolean;
  numMovimientos:  number;
  banco:           string | null;
  movFecha:        string | null;
  movFolio:        string | null;
  deposito:        number | null;
  movConcepto:     string | null;
  numOperacion:    string | null;
  diferencia:      number;
  saldoMovimiento: number | null;
}

export interface DepositosIngresosResumen {
  contado: { cantidad: number; monto: number };
  credito: { cantidad: number; monto: number };
}

export interface DepositosIngresosResponse {
  data:    DepositoIngresoRow[];
  total:   number;
  page:    number;
  limit:   number;
  pages:   number;
  resumen: DepositosIngresosResumen;
}

export interface CuentaPorCobrarMovimiento {
  serie:          string | null;
  folio:          string | null;
  serieOrigen:    string | null;
  folioOrigen:    string | null;
  saldoAnterior:  number | null;
  saldoActual:    number | null;
  subtotal:       number | null;
  impuesto:       number | null;
  total:          number | null;
  // true si la serie tiene autorización bancaria real (CBT/ABO/CPF/CFC);
  // false = ajuste sin depósito (bonificación, descuento, devolución, retención, etc.)
  esPagoBancario: boolean;
  // true = este movimiento NO viene del kardex del ERP; se agregó porque una
  // Nota de Crédito (exacta o inferida) lo explica pero el ERP aún no lo registra.
  esVirtual?:     boolean;
  // Presente cuando este movimiento (real o virtual) se vincula a una Nota de
  // Crédito Vigente relacionada a la factura.
  notaCredito?: {
    uuid:      string;
    serie:     string | null;
    folio:     string | null;
    tipo:      string;
    // 'exacta' = la NC trae una referencia real (documentosRelacionados) a esta
    //            CxC específica — confirmado, no es una suposición.
    // 'inferida' = solo coincide el monto (±$1) — es una suposición, y por eso
    //              nunca aparece en Facturas Globales (demasiado riesgo de cruzar
    //              con el saldo de otro cliente que comparte el mismo folio fiscal).
    confianza: 'exacta' | 'inferida';
  };
}

export interface CuentaPorCobrarAfectada {
  erpId:           string;
  serie:           string | null;
  folio:           string | null;
  serieExterna:    string | null;
  folioExterno:    string | null;
  total:           number | null;
  saldoActual:     number | null;
  concepto:        string | null;
  tipoPago:        string | null;
  tipoMovimiento:  string | null;
  fechaCreacion:   string | null;
  fechaAfectacion: string | null;
  fechaRealPago:   string | null;
  movimientos:     CuentaPorCobrarMovimiento[];
}

export interface DepositosIngresosDetalle {
  factura: {
    uuid: string;
    satStatus: string;
    serie: string;
    folio: string;
    total: number;
    fecha: string;
    metodoPago: string;
    receptor?: { rfc: string; nombre?: string } | null;
  } | null;
  movimientos: {
    banco: string;
    fecha: string;
    deposito: number;
    retiro: number;
    folio: string;
    concepto: string;
    status: string;
    numeroAutorizacion: string | null;
    referenciaNumerica: string | null;
    erpLinks: {
      erpId:          string;
      folioFiscal:    string | null;
      folioExterno:   string | null;
      serie:          string | null;
      saldoActual:    number;
      total:          number | null;
      tieneRetencion: boolean;
    }[];
  }[];
  cuentasPorCobrar: CuentaPorCobrarAfectada[];
  egresosRelacionados: EgresoRelacionado[];
  // true si la factura es Global (receptor Público en General / nodo InformacionGlobal).
  // En ese caso el backend NO cruza por monto CxC↔Notas de Crédito (no es confiable).
  facturaEsGlobal: boolean;
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  constructor(private api: ApiService) {}

  getPagosBanco(filtros: PagosBancoFiltros = {}): Observable<PagosBancoResponse> {
    return this.api.get<PagosBancoResponse>('/reports/pagos-banco', filtros as Record<string, unknown>);
  }

  getDetalle(facturaUuid: string): Observable<PagosBancoDetalle> {
    return this.api.get<PagosBancoDetalle>('/reports/pagos-banco/detalle', { facturaUuid } as Record<string, unknown>);
  }

  exportPagosBanco(filtros: Omit<PagosBancoFiltros, 'page' | 'limit'> = {}): Observable<Blob> {
    return this.api.downloadBlob('/reports/pagos-banco/export', filtros as Record<string, unknown>);
  }

  getBancosDistintos(): Observable<string[]> {
    return this.api.get<string[]>('/reports/pagos-banco/bancos');
  }

  getDepositosIngresos(filtros: DepositosIngresosFiltros = {}): Observable<DepositosIngresosResponse> {
    return this.api.get<DepositosIngresosResponse>('/reports/depositos-ingresos', filtros as Record<string, unknown>);
  }

  getDepositoIngresoDetalle(facturaUuid: string): Observable<DepositosIngresosDetalle> {
    return this.api.get<DepositosIngresosDetalle>('/reports/depositos-ingresos/detalle', { facturaUuid } as Record<string, unknown>);
  }

  exportDepositosIngresos(filtros: Omit<DepositosIngresosFiltros, 'page' | 'limit'> = {}): Observable<Blob> {
    return this.api.downloadBlob('/reports/depositos-ingresos/export', filtros as Record<string, unknown>);
  }
}
