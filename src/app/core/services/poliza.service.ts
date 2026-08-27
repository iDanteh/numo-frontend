import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { ApiService } from './api.service';
import { environment } from '../../../environments/environment';

// ── Modelos ───────────────────────────────────────────────────────────────────

export type PolizaTipo   = 'A' | 'I' | 'E' | 'D' | 'N' | 'C' | 'P' | 'T';
export type PolizaEstado = 'borrador' | 'contabilizada' | 'cancelada';

export interface CfdiAlertInfo {
  satStatus?: string | null;
  erpStatus?: string | null;
  alerts: string[];
  // Solo presente cuando alerts incluye 'cancelado_sat' — ver findById en
  // poliza.repository.js. null = cancelado sin sustituto todavía.
  sustituto?: { uuid: string; serie: string | null; folio: string | null } | null;
}

export interface CfdiMetaInfo {
  metodoPago?: string | null;
  formaPago?:  string | null;
}

export interface PolizaMovimiento {
  id?:          number;
  orden?:       number;
  cuentaId:     number;
  concepto:     string;
  serie?:       string;
  ventaFecha?:  string;
  centroCosto?: string;
  debe:         number;
  haber:        number;
  cfdiUuid?:       string;
  rfcTercero?:     string;
  cuentaFaltante?: boolean;
  reglaNombre?:    string | null;
  reglaId?:        number | null;
  regla?: {
    id:              number;
    nombre:          string;
    prioridad:       number;
    tipoComprobante: string | null;
    metodoPago:      string | null;
    formaPago:       string | null;
    isActive:        boolean;
  } | null;
  cuenta?: {
    id:         number;
    codigo:     string;
    nombre:     string;
    tipo:       string;
    naturaleza: string;
  };
}

export interface Poliza {
  id?:           number;
  tipo:          PolizaTipo;
  numero?:       number;
  folio?:        string;
  fecha:         string;
  concepto:      string;
  ejercicio:     number;
  periodo:       number;
  centroCosto?:  string;
  rfc:           string;
  estado?:            PolizaEstado;
  creadoPor?:         string;
  createdAt?:         string;
  contabilizadoPor?:  string;
  contabilizadaAt?:   string;
  canceladoPor?:        string;
  canceladaAt?:         string;
  motivoCancelacion?:   string;
  revertidoPor?:        string;
  revertidaAt?:         string;
  motivoReversion?:     string;
  contpaqFolioContado?: number | null;
  contpaqFolioCredito?: number | null;
  contpaqAsociadoPor?:  string | null;
  contpaqAsociadoEn?:   string | null;
  movimientos?:       PolizaMovimiento[];
  cfdiSummary?: {
    total:      number;
    vigentes:   number;
    cancelados: number;
    ambosLados: number;
    soloSat:    number;
  };
  cfdiAlertMap?: Record<string, CfdiAlertInfo>;
  cfdiMetaMap?:  Record<string, CfdiMetaInfo>;
}

export interface PolizaFilter {
  rfc?:       string;
  ejercicio?: number;
  periodo?:   number;
  tipo?:      string;
  estado?:    string;
  q?:         string;
  page?:      number;
  limit?:     number;
  // Vista "Pólizas de Cobranza": solo pólizas con movimientos de CFDI de Pago
  soloCobranza?: boolean;
}

export interface PolizaListResponse {
  total:    number;
  page:     number;
  limit:    number;
  pages:    number;
  polizas:  Poliza[];
}

export interface DescuadradoCfdi {
  polizaId:   number;
  tipo:       string;
  numero:     number;
  fecha:      string;
  estado:     string;
  cfdiUuid:   string;
  totalDebe:  number;
  totalHaber: number;
  diferencia: number;
  cfdi: {
    tipoDeComprobante:  string;
    serie?:             string;
    folio?:             string;
    fecha?:             string;
    moneda?:            string;
    lugarExpedicion?:   string;
    emisor?:            { rfc: string; nombre: string; regimenFiscal?: string };
    receptor?:          { rfc: string; nombre: string; usoCfdi?: string };
    metodoPago?:        string;
    formaPago?:         string;
    subTotal?:          number;
    total?:             number;
    impuestos?:         { totalImpuestosTrasladados?: number };
    satStatus?:         string;
    erpStatus?:         string;
    sources?:           string[];
  } | null;
}

export interface ReporteDescuadradasResponse {
  total: number;
  rows:  DescuadradoCfdi[];
}

export interface CuentaPuentePendiente {
  cuentaId:       number;
  codigo:         string;
  nombre:         string;
  cantidadLineas: number;
  monto:          number;
}

export interface CuentasBancoPendientesResponse {
  actualizados: number;
  pendientes:   CuentaPuentePendiente[];
}

// ── Servicio ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class PolizaService {
  constructor(private api: ApiService, private http: HttpClient) {}

  list(filters: PolizaFilter = {}): Observable<PolizaListResponse> {
    return this.api.get<PolizaListResponse>('/polizas', filters as Record<string, unknown>);
  }

  getById(id: number): Observable<Poliza> {
    return this.api.get<Poliza>(`/polizas/${id}`);
  }

  create(data: Poliza): Observable<Poliza> {
    return this.api.post<Poliza>('/polizas', data);
  }

  update(id: number, data: Partial<Poliza>): Observable<Poliza> {
    return this.api.patch<Poliza>(`/polizas/${id}`, data);
  }

  contabilizar(id: number): Observable<Poliza> {
    return this.api.post<Poliza>(`/polizas/${id}/contabilizar`, {});
  }

  resolverCuentasBanco(id: number): Observable<CuentasBancoPendientesResponse> {
    return this.api.post<CuentasBancoPendientesResponse>(`/polizas/${id}/resolver-cuentas-banco`, {});
  }

  reemplazarCuenta(id: number, cuentaPuenteId: number, cuentaDestinoId: number): Observable<{ afectados: number; poliza: Poliza }> {
    return this.api.post(`/polizas/${id}/reemplazar-cuenta`, { cuentaPuenteId, cuentaDestinoId });
  }

  // Resuelve el BankMovement de Mongo del que salió un cargo/abono de Traspasos,
  // para navegar desde "ver movimientos" hasta el registro real en Bancos.
  resolverBankMovimientoDeTraspaso(polizaId: number, movimientoId: number): Observable<{ bankMovementId: string; banco: string }> {
    return this.api.get<{ bankMovementId: string; banco: string }>(`/polizas/${polizaId}/traspasos-movimiento/${movimientoId}/banco`);
  }

  generarCierreIVA(params: { rfc: string; ejercicio: number; periodo: number }): Observable<{ poliza: Poliza; netIVA: number; totalDebe: number; totalHaber: number }> {
    let p = new HttpParams()
      .set('rfc', params.rfc)
      .set('ejercicio', String(params.ejercicio))
      .set('periodo', String(params.periodo));
    return this.api.post(`/polizas/cierre-iva?${p.toString()}`, {});
  }

  xmlSat(params: { rfc: string; ejercicio: number; periodo: number; tipoSolicitud?: string; numOrden?: string; numTramite?: string }): Observable<Blob> {
    let p = new HttpParams()
      .set('rfc', params.rfc)
      .set('ejercicio', String(params.ejercicio))
      .set('periodo', String(params.periodo));
    if (params.tipoSolicitud) p = p.set('tipoSolicitud', params.tipoSolicitud);
    if (params.numOrden)      p = p.set('numOrden', params.numOrden);
    if (params.numTramite)    p = p.set('numTramite', params.numTramite);
    return this.http.get(`${environment.apiUrl}/polizas/xml-sat`, { params: p, responseType: 'blob' });
  }

  cancelar(id: number, motivo?: string): Observable<Poliza> {
    return this.api.post<Poliza>(`/polizas/${id}/cancelar`, { motivo: motivo || null });
  }

  // Cancela las pólizas en estado 'borrador' del rfc/ejercicio/periodo
  // indicado (las contabilizadas y ya canceladas quedan fuera). Si se manda
  // polizaIds, solo cancela esas — si no, cancela todas las de borrador.
  cancelarTodas(params: { rfc: string; ejercicio: number; periodo: number; motivo?: string; polizaIds?: number[] }): Observable<{ canceladas: number; total: number; errores: { polizaId: number; numero: number; tipo: string; error: string }[] }> {
    return this.api.post(`/polizas/cancelar-todas`, params);
  }

  // Lista TODAS las pólizas en borrador del periodo (sin el tope de 100 de la
  // lista paginada) — para el modal de selección de "Cancelar todas".
  listBorradorCandidatas(params: { rfc: string; ejercicio: number; periodo: number; soloCobranza?: boolean }): Observable<Poliza[]> {
    return this.api.get<Poliza[]>('/polizas/borrador-candidatas', params as Record<string, unknown>);
  }

  revertir(id: number, motivo?: string, revertirCuentas = true): Observable<Poliza> {
    return this.api.post<Poliza>(`/polizas/${id}/revertir`, { motivo: motivo || null, revertirCuentas });
  }

  reporteDescuadradas(filters: { rfc: string; ejercicio?: number; periodo?: number; estado?: string; polizaId?: number }): Observable<ReporteDescuadradasResponse> {
    return this.api.get<ReporteDescuadradasResponse>('/polizas/reporte-descuadradas', filters as Record<string, unknown>);
  }

  downloadReporteDescuadradas(filters: { rfc: string; ejercicio?: number; periodo?: number; estado?: string }): Observable<Blob> {
    let p = new HttpParams().set('rfc', filters.rfc).set('format', 'csv');
    if (filters.ejercicio) p = p.set('ejercicio', String(filters.ejercicio));
    if (filters.periodo)   p = p.set('periodo',   String(filters.periodo));
    if (filters.estado)    p = p.set('estado',     filters.estado);
    return this.http.get(`${environment.apiUrl}/polizas/reporte-descuadradas`, { params: p, responseType: 'blob' });
  }

  // `observe: 'response'` (en vez de solo el Blob) porque CEDIS puede devolver
  // un .zip (varias pólizas separadas) en vez de un solo .xlsx — el caller
  // necesita leer el Content-Type/Content-Disposition reales para nombrar y
  // descargar el archivo con la extensión correcta (ver poliza-list.component.ts).
  exportarContpaq(id: number, overrides?: {
    fecha?: string; folioContado?: number; conceptoContado?: string;
    folioCredito?: number; conceptoCredito?: string; centroCostoIds?: number[];
  }): Observable<HttpResponse<Blob>> {
    let p = new HttpParams();
    if (overrides?.fecha)           p = p.set('fecha',           overrides.fecha);
    if (overrides?.folioContado    != null) p = p.set('folioContado',    String(overrides.folioContado));
    if (overrides?.conceptoContado) p = p.set('conceptoContado', overrides.conceptoContado);
    if (overrides?.folioCredito    != null) p = p.set('folioCredito',    String(overrides.folioCredito));
    if (overrides?.conceptoCredito) p = p.set('conceptoCredito', overrides.conceptoCredito);
    if (overrides?.centroCostoIds  && overrides.centroCostoIds.length > 0) {
      p = p.set('centroCostoIds', overrides.centroCostoIds.join(','));
    }
    return this.http.get(`${environment.apiUrl}/polizas/${id}/export-contpaq`, {
      params: p, responseType: 'blob', observe: 'response',
    });
  }

  asociarFolioContpaq(id: number, body: { folioContado?: number | null; folioCredito?: number | null }): Observable<Poliza> {
    return this.api.patch<Poliza>(`/polizas/${id}/contpaq-folio`, body);
  }

  // ── Pólizas Traspasos C.P. (2026-08-25) ───────────────────────────────────────
  // Genera y PERSISTE (a diferencia del viejo flujo standalone de bank.service.ts
  // #descargarPolizaContpaqTraspasos, que solo armaba un Excel sin tocar Postgres)
  // una póliza tipo='T' por cada día del rango con traspasos relacionados.
  generarTraspasos(params: { rfc: string; fechaInicio: string; fechaFin: string }): Observable<{ polizas: Poliza[] }> {
    return this.api.post('/polizas/traspasos/generar', params);
  }

  // Mismo patrón de Blob que exportarContpaq — pero sobre una póliza tipo='T' ya
  // persistida (reconstruye el Excel desde Poliza.traspasosPares en el backend).
  exportarContpaqTraspasos(id: number): Observable<HttpResponse<Blob>> {
    return this.http.get(`${environment.apiUrl}/polizas/${id}/export-contpaq-traspasos`, {
      responseType: 'blob', observe: 'response',
    });
  }
}
