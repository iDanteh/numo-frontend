import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpClient, HttpParams } from '@angular/common/http';
import { ApiService } from './api.service';
import { environment } from '../../../environments/environment';

// ── Modelos ───────────────────────────────────────────────────────────────────

export type PolizaTipo   = 'A' | 'I' | 'E' | 'D' | 'N' | 'C';
export type PolizaEstado = 'borrador' | 'contabilizada' | 'cancelada';

export interface CfdiAlertInfo {
  satStatus?: string | null;
  erpStatus?: string | null;
  alerts: string[];
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
  movimientos?:       PolizaMovimiento[];
  cfdiSummary?: {
    total:      number;
    vigentes:   number;
    cancelados: number;
    ambosLados: number;
    soloSat:    number;
  };
  cfdiAlertMap?: Record<string, CfdiAlertInfo>;
}

export interface PolizaFilter {
  rfc?:       string;
  ejercicio?: number;
  periodo?:   number;
  tipo?:      string;
  estado?:    string;
  page?:      number;
  limit?:     number;
}

export interface PolizaListResponse {
  total:    number;
  page:     number;
  limit:    number;
  pages:    number;
  polizas:  Poliza[];
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

  revertir(id: number, motivo?: string): Observable<Poliza> {
    return this.api.post<Poliza>(`/polizas/${id}/revertir`, { motivo: motivo || null });
  }
}
