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
  saldoBanco:       number | null;
  identificadoPor:  string | null;
  tipoNC:           string | null;
  montoNC:          number | null;
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

// ── Sugerencias de conciliación (fallback monto+fecha / firma bancaria) ──────
// Ver numo-backend/src/visor/services/conciliacion-sugerencias.service.js. Cubren
// depósitos 'no_identificado' cuya CxC ya no está en erp_cuentas_pendientes (ya
// saldada en el ERP), donde el motor real de match no tiene con qué cruzar.

export type EstadoSugerencia =
  | 'CONFIRMADO_FIRMA_CFDI'
  | 'MATCH_UNICO_MONTO_FECHA'
  | 'SOLO_FIRMA'
  | 'AMBIGUO';

export interface SugerenciaFacturaDetalle {
  idDocumento: string;
  serie:       string | null;
  folio:       string | null;
  impPagado:   number | null;
}

export interface SugerenciaCandidato {
  tipo:            'factura' | 'pago_completo';
  cfdiPagoUuid:    string;
  folioPago:       string | null;
  rfc:             string | null;
  receptorNombre:  string;
  fechaPago:       string;
  diffMonto:       number;
  diffDias:        number;
  // tipo === 'factura'
  idDocumento?:    string;
  serieFactura?:   string | null;
  folioFactura?:   string | null;
  impPagado?:      number;
  // tipo === 'pago_completo'
  monto?:          number;
  facturas?:       string[];
  facturasDetalle?: SugerenciaFacturaDetalle[];
}

export interface SugerenciaClienteInfo {
  rfc:  string;
  nombre: string | null;
  vecesVistoEnHistorico: number;
  firma: { tipo: 'cuenta_bnet' | 'nombre_emisor'; valor: string };
}

export interface SugerenciaConciliacion {
  movimiento: {
    _id: string; banco: string; fecha: string; deposito: number;
    folio: string | null; concepto: string | null;
  };
  estado:      EstadoSugerencia;
  clienteSugerido?: SugerenciaClienteInfo;
  ambiguedadResueltaPorFirma?: boolean;
  nota?:       string;
  candidatos:  SugerenciaCandidato[];
}

export interface SugerenciasConciliacionResult {
  resumen: {
    totalMovimientos: number;
    CONFIRMADO_FIRMA_CFDI: number;
    MATCH_UNICO_MONTO_FECHA: number;
    SOLO_FIRMA: number;
    AMBIGUO: number;
    SIN_SUGERENCIA: number;
  };
  sugerencias: SugerenciaConciliacion[];
}

// Shape mínimo de ErpLink necesario para aceptar una sugerencia vía el endpoint YA
// EXISTENTE de bancos (PUT /banks/movements/:id/erp-ids) -- no se importa desde el
// feature de bancos para no acoplar el visor a ese módulo; es el mismo contrato.
export interface ErpLinkParaAceptar {
  erpId:             string;
  saldoActual:       number;
  saldoPagado?:      number | null;
  saldoPagadoTotal?: number | null;
  total:             number;
  folioFiscal:       string | null;
  serie?:            string | null;
  folioExterno?:     string | null;
  tipoPago?:         string | null;
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  constructor(private api: ApiService) {}

  getPagosBanco(filtros: PagosBancoFiltros = {}): Observable<PagosBancoResponse> {
    return this.api.get<PagosBancoResponse>('/reports/pagos-banco', filtros as Record<string, unknown>);
  }

  getSugerenciasConciliacion(fechaInicio: string, fechaFin: string, banco?: string | null): Observable<SugerenciasConciliacionResult> {
    const params: Record<string, unknown> = { fechaInicio, fechaFin };
    if (banco) params['banco'] = banco;
    return this.api.get<SugerenciasConciliacionResult>('/reports/pagos-banco/sugerencias-conciliacion', params);
  }

  // Acepta una sugerencia: llama al endpoint YA EXISTENTE de vinculación manual
  // (el mismo que usa el modal de Bancos) -- no se agrega lógica de escritura nueva.
  aceptarSugerencia(movimientoId: string, erpLinks: ErpLinkParaAceptar[]): Observable<{ _id: string; status: string }> {
    return this.api.put(`/banks/movements/${movimientoId}/erp-ids`, { erpLinks });
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
