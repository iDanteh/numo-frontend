import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiService } from './api.service';
import { Poliza } from './poliza.service';
import { environment } from '../../../environments/environment';

export interface CfdiMappingRule {
  id?:                  number;
  nombre:               string;
  // Filtros de matching
  tipoComprobante?:     'I' | 'E' | 'P' | null;
  rfcEmisor?:           string | null;
  rfcReceptor?:         string | null;
  metodoPago?:          'PPD' | 'PUE' | null;
  formaPago?:           string | null;
  claveProdServ?:       string | null;
  tipoRelacion?:        string | null;
  relacionadoTipo?:     'I' | 'E' | 'P' | null;
  tasaIva?:             '0' | '16' | 'mixto' | null;
  tieneDescuento?:      boolean | null;
  conceptoContiene?:    string | null;
  tipoOrigen?:          string | null;
  // Cuentas principales
  cuentaCargo:          string;
  cuentaAbono:          string;
  // Cuentas IVA
  cuentaIva?:           string | null;
  cuentaIvaPPD?:        string | null;
  cuentaIvaRetenido?:   string | null;
  cuentaIsrRetenido?:   string | null;
  cuentaIvaAnticipo?:   string | null;
  // Cuentas adicionales
  cuentaAbono2?:        string | null;
  cuentaCargo2?:        string | null;
  cuentaDeltaAnticipo?: string | null;
  cuentaDescuento?:     string | null;
  cuentaDescuento0?:    string | null;
  // Flags especiales
  ivaHaber?:            boolean | null;
  esAplicacionSaldo?:   boolean | null;
  // Otros
  centroCosto?:         string | null;
  vecesUsada?:          number;
  vecesUsadaActiva?:    number;
  prioridad:            number;
  isActive:             boolean;
}

export interface BalanzaCuenta {
  codigo:        string;
  nombre:        string;
  tipo:          string;
  debe:          number;
  haber:         number;
  saldoInicial:  number;
  saldo:         number;
  movCount:      number;
  nivel?:        number;
  esAgrupadora?: boolean;  // true = cuenta padre; excluir de sumas iguales
}

export interface BalanzaPreliminar {
  cuentas:  BalanzaCuenta[];
  totales:  { debe: number; haber: number; saldoInicial: number };
  meta:     { totalCfdis: number; sinRegla: number; periodo: number; ejercicio: number; tipos: string[] };
}

export interface BalanceGrupo {
  cuentas: BalanzaCuenta[];
  total:   number;
}

export interface BalanceGeneral {
  activo:      BalanceGrupo;
  pasivo:      BalanceGrupo;
  capital:     BalanceGrupo;
  resultados: {
    ingresos: BalanceGrupo;
    gastos:   BalanceGrupo;
    utilidad: number;
  };
  totales: { activo: number; pasivoCapital: number; cuadra: boolean };
  meta:    { totalCfdis: number; sinRegla: number; periodo: number; ejercicio: number; tipos: string[] };
}

export interface BalanzaCuentaCfdiRegla {
  nombre: string; prioridad: number; isActive: boolean;
  tipoComprobante:   string | null; metodoPago:        string | null;
  formaPago:         string | null; tasaIva:           string | null;
  rfcEmisor:         string | null; rfcReceptor:       string | null;
  tipoRelacion:      string | null; relacionadoTipo:   string | null;
  tipoOrigen:        string | null; tieneDescuento:    boolean | null;
  conceptoContiene:  string | null; claveProdServ:     string | null;
  cuentaCargo: string; cuentaAbono: string;
  cuentaAbono2:       string | null; cuentaIva:          string | null;
  cuentaIvaPPD:       string | null; cuentaIvaRetenido:  string | null;
  cuentaIsrRetenido:  string | null; cuentaIvaAnticipo:  string | null;
  cuentaDeltaAnticipo:string | null; cuentaCargo2:       string | null;
  cuentaDescuento:    string | null; centroCosto:        string | null;
  ivaHaber:           boolean | null; esAplicacionSaldo: boolean | null;
}

export interface BalanzaCuentaCfdi {
  uuid:              string;
  tipoDeComprobante: string;
  fecha:             string;
  folio:             string | null;
  serie:             string | null;
  rfcEmisor:         string | null;
  rfcReceptor:       string | null;
  emisorNombre:      string | null;
  receptorNombre:    string | null;
  subTotal:          number;
  descuento:         number;
  total:             number;
  baseIva16?:        number;
  baseIva0?:         number;
  debe:              number;
  haber:             number;
  reglaNombre:       string;
  formaPago:         string | null;
  metodoPago:        string | null;
  concepto:          string | null;
  tasaIvaDetectada:  string | null;
  tipoRelacion:      string | null;
  conceptos:         Array<{ descripcion: string; importe: number }>;
  cfdiRelacionados:  Array<{ tipoRelacion: string; uuids: string[] }>;
  regla:             BalanzaCuentaCfdiRegla;
  porQue:            string[];
  fueReemplazado?:   boolean;
  reemplazadoPor?:   string | null;
  esSustituto?:      boolean;
  sustituyeA?:       string[] | null;
}

export interface BalanzaCuentaDetalle {
  cuenta:  { codigo: string; nombre: string; tipo: string };
  cfdis:   BalanzaCuentaCfdi[];
  totales: { debe: number; haber: number };
}

export interface GenerarYGuardarResult {
  polizaId:     number;
  totalCfdis:   number;
  sinRegla:     number;
  advertencias: string[];
}

export interface GenerarPorSucursalResultado {
  centroCosto:   string;
  centroCostoId: number;
  polizaId?:     number;
  totalCfdis?:   number;
  sinRegla?:     number;
  advertencias?: string[];
  error?:        string;
}

export interface GenerarPorSucursalResult {
  resultados: GenerarPorSucursalResultado[];
}

export interface GenerarPorDiaResultado {
  fecha:         string;
  polizaId?:     number;
  totalCfdis?:   number;
  sinRegla?:     number;
  advertencias?: string[];
  error?:        string;
}

export interface GenerarPorDiaResult {
  resultados: GenerarPorDiaResultado[];
}

export interface MigrarPpdDescuentoResult {
  actualizadas: string[];
  insertadas:   string[];
  yaExistian:   string[];
}

export interface PolizaUso {
  id:                  number;
  tipo:                string;
  numero:              number;
  fecha:               string;
  concepto:            string;
  ejercicio:           number;
  periodo:             number;
  rfc:                 string;
  estado:              string;
  movimientosConRegla: number;
}

export interface PolizaPropuesta extends Poliza {
  _meta: {
    totalCfdis:   number;
    sinRegla:     number;
    advertencias: string[];
  };
}

@Injectable({ providedIn: 'root' })
export class CfdiMappingService {
  constructor(private api: ApiService, private http: HttpClient) {}

  listRules(): Observable<CfdiMappingRule[]> {
    return this.api.get<CfdiMappingRule[]>('/cfdi-mapping/rules');
  }

  getRulePolizas(ruleId: number): Observable<PolizaUso[]> {
    return this.api.get<PolizaUso[]>(`/cfdi-mapping/rules/${ruleId}/polizas`);
  }

  createRule(data: CfdiMappingRule): Observable<CfdiMappingRule> {
    return this.api.post<CfdiMappingRule>('/cfdi-mapping/rules', data);
  }

  updateRule(id: number, data: Partial<CfdiMappingRule>): Observable<CfdiMappingRule> {
    return this.api.patch<CfdiMappingRule>(`/cfdi-mapping/rules/${id}`, data);
  }

  deleteRule(id: number): Observable<void> {
    return this.api.delete<void>(`/cfdi-mapping/rules/${id}`);
  }

  generarPropuesta(params: { rfc: string; ejercicio: number; periodo: number; tipoPropuesta?: string; tipoCfdi: 'I' | 'E' | 'P'; centroCostoId?: number | null; fechaInicio?: string; fechaFin?: string }): Observable<PolizaPropuesta> {
    return this.api.post<PolizaPropuesta>('/cfdi-mapping/generar-propuesta', params);
  }

  generarYGuardar(params: { rfc: string; ejercicio: number; periodo: number; tipoPropuesta?: string; tipoCfdi: 'I' | 'E' | 'P'; centroCostoId?: number | null; fechaInicio?: string; fechaFin?: string }): Observable<GenerarYGuardarResult> {
    return this.api.post<GenerarYGuardarResult>('/cfdi-mapping/generar-y-guardar', params);
  }

  // Genera una póliza SEPARADA por cada sucursal (centro de costo) con CFDIs
  // sin póliza en el periodo, en vez de mezclar todo en una sola.
  generarYGuardarPorSucursal(params: { rfc: string; ejercicio: number; periodo: number; tipoPropuesta?: string; tipoCfdi: 'I' | 'E' | 'P'; fechaInicio?: string; fechaFin?: string }): Observable<GenerarPorSucursalResult> {
    return this.api.post<GenerarPorSucursalResult>('/cfdi-mapping/generar-y-guardar-por-sucursal', params);
  }

  // Genera una póliza SEPARADA por cada día del rango (o del mes completo si
  // no se especifica fechaInicio/fechaFin), en vez de mezclar todo en una sola.
  generarYGuardarPorDia(params: { rfc: string; ejercicio: number; periodo: number; tipoPropuesta?: string; tipoCfdi: 'I' | 'E' | 'P'; centroCostoId?: number | null; fechaInicio?: string; fechaFin?: string }): Observable<GenerarPorDiaResult> {
    return this.api.post<GenerarPorDiaResult>('/cfdi-mapping/generar-y-guardar-por-dia', params);
  }

  // Genera (si hace falta) las pólizas del modo pedido y regresa un ZIP con el
  // .xlsx de CONTPAQ de cada una — carpeta por sucursal cuando el modo incluye
  // sucursal, un archivo por día cuando incluye día, más un _resumen.txt.
  exportarContpaqZip(params: { rfc: string; ejercicio: number; periodo: number; tipoCfdi: 'I' | 'E' | 'P'; tipoPropuesta?: string; modo: 'porSucursal' | 'porDia' | 'porDiaYSucursal'; fechaInicio?: string; fechaFin?: string }): Observable<Blob> {
    return this.http.post(`${environment.apiUrl}/cfdi-mapping/exportar-contpaq-zip`, params, { responseType: 'blob' });
  }

  balanceGeneral(params: { rfc: string; ejercicio: number; periodo: number }): Observable<BalanceGeneral> {
    const q = new URLSearchParams({
      rfc:       params.rfc,
      ejercicio: String(params.ejercicio),
      periodo:   String(params.periodo),
    });
    return this.api.get<BalanceGeneral>(`/cfdi-mapping/balance-general?${q}`);
  }

  reporteAnticipos(params: { rfc: string; ejercicio: number; periodo: number }): Observable<{
    total: number;
    anticipos: {
      uuid: string; serie: string; folio: string; tipoComprobante: string;
      metodoPago: string; formaPago: string; fecha: string;
      subTotal: number; total: number;
      rfcEmisor: string; rfcReceptor: string; nombreReceptor: string;
      uuidRelacionado: string; tipoRelacion: string;
    }[];
  }> {
    const q = new URLSearchParams({
      rfc: params.rfc, ejercicio: String(params.ejercicio), periodo: String(params.periodo),
    });
    return this.api.get(`/cfdi-mapping/reporte-anticipos?${q}`);
  }

  reporteSustitutos(params: { rfc: string; ejercicio: number; periodo: number }): Observable<{
    total: number;
    ingresos: any[]; egresos: any[]; pagos: any[];
  }> {
    const q = new URLSearchParams({
      rfc: params.rfc, ejercicio: String(params.ejercicio), periodo: String(params.periodo),
    });
    return this.api.get(`/cfdi-mapping/reporte-sustitutos?${q}`);
  }

  balanzaCuentaCfdis(params: {
    rfc: string; ejercicio: number; periodo: number; cuentaCodigo: string;
    tipoCfdi?: string;
    excluirPagosSustitutos?: boolean; excluirAplicacionesAnticipos?: boolean;
    excluirReclasificaciones?: boolean; incluirFechaCruzada?: boolean; excluirMesesPosteriores?: boolean;
  }): Observable<BalanzaCuentaDetalle> {
    const q = new URLSearchParams({
      rfc: params.rfc, ejercicio: String(params.ejercicio), periodo: String(params.periodo),
      cuentaCodigo: params.cuentaCodigo,
      ...(params.tipoCfdi                     ? { tipoCfdi: params.tipoCfdi } : {}),
      ...(params.excluirPagosSustitutos       ? { excluirPagosSustitutos: 'true' } : {}),
      ...(params.excluirAplicacionesAnticipos ? { excluirAplicacionesAnticipos: 'true' } : {}),
      ...(params.excluirReclasificaciones     ? { excluirReclasificaciones: 'true' } : {}),
      ...(params.incluirFechaCruzada          ? { incluirFechaCruzada: 'true' } : {}),
      ...(params.excluirMesesPosteriores      ? { excluirMesesPosteriores: 'true' } : {}),
    });
    return this.api.get<BalanzaCuentaDetalle>(`/cfdi-mapping/balanza-cuenta-cfdis?${q}`);
  }

  balanzaDetalleExport(params: {
    rfc: string; ejercicio: number; periodo: number;
    tipoCfdi?: string;
    excluirPagosSustitutos?: boolean; excluirAplicacionesAnticipos?: boolean;
    excluirReclasificaciones?: boolean; incluirFechaCruzada?: boolean; excluirMesesPosteriores?: boolean;
  }): Observable<{
    entradas: {
      cuentaCodigo: string; cuentaNombre: string; cuentaTipo: string;
      uuid: string; tipoDeComprobante: string; fecha: string;
      folio: string | null; serie: string | null;
      rfcEmisor: string | null; emisorNombre: string | null;
      rfcReceptor: string | null; receptorNombre: string | null;
      subTotal: number; descuento: number; total: number;
      formaPago: string | null; metodoPago: string | null; tasaIvaDetectada: string | null;
      debe: number; haber: number; concepto: string | null;
      reglaNombre: string; porQue: string[];
    }[];
    sinRegla: number;
  }> {
    const q = new URLSearchParams({
      rfc: params.rfc, ejercicio: String(params.ejercicio), periodo: String(params.periodo),
      ...(params.tipoCfdi                     ? { tipoCfdi: params.tipoCfdi } : {}),
      ...(params.excluirPagosSustitutos       ? { excluirPagosSustitutos: 'true' } : {}),
      ...(params.excluirAplicacionesAnticipos ? { excluirAplicacionesAnticipos: 'true' } : {}),
      ...(params.excluirReclasificaciones     ? { excluirReclasificaciones: 'true' } : {}),
      ...(params.incluirFechaCruzada          ? { incluirFechaCruzada: 'true' } : {}),
      ...(params.excluirMesesPosteriores      ? { excluirMesesPosteriores: 'true' } : {}),
    });
    return this.api.get(`/cfdi-mapping/balanza-detalle-export?${q}`);
  }

  migrarPpdDescuento(): Observable<MigrarPpdDescuentoResult> {
    return this.api.post<MigrarPpdDescuentoResult>('/cfdi-mapping/rules/migrar-ppd-descuento', {});
  }

  balanzaPreliminar(params: {
    rfc: string; ejercicio: number; periodo: number;
    tipoCfdi?: string;
    excluirPagosSustitutos?: boolean;
    excluirAplicacionesAnticipos?: boolean;
    excluirReclasificaciones?: boolean;
    incluirFechaCruzada?: boolean;
    excluirMesesPosteriores?: boolean;
  }): Observable<BalanzaPreliminar> {
    const q = new URLSearchParams({
      rfc:       params.rfc,
      ejercicio: String(params.ejercicio),
      periodo:   String(params.periodo),
      ...(params.tipoCfdi                     ? { tipoCfdi: params.tipoCfdi } : {}),
      ...(params.excluirPagosSustitutos       ? { excluirPagosSustitutos: 'true' } : {}),
      ...(params.excluirAplicacionesAnticipos ? { excluirAplicacionesAnticipos: 'true' } : {}),
      ...(params.excluirReclasificaciones     ? { excluirReclasificaciones: 'true' }     : {}),
      ...(params.incluirFechaCruzada          ? { incluirFechaCruzada: 'true' }          : {}),
      ...(params.excluirMesesPosteriores      ? { excluirMesesPosteriores: 'true' }      : {}),
    });
    return this.api.get<BalanzaPreliminar>(`/cfdi-mapping/balanza-preliminar?${q}`);
  }
}
