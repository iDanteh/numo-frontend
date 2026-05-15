import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type PolizaTipo = 'A' | 'I' | 'E' | 'D' | 'N' | 'C';
export type PolizaEstado = 'borrador' | 'contabilizada' | 'cancelada';

export interface CuentaResumen {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  naturaleza: string;
}

export interface PolizaMovimiento {
  id?: number;
  polizaId?: number;
  cuentaId: number | null;
  concepto: string;
  debe: number;
  haber: number;
  cfdiUuid?: string | null;
  rfcTercero?: string | null;
  cuenta?: CuentaResumen;
  cuentaFaltante?: boolean;
}

export interface CfdiSummary {
  total: number;
  vigentes: number;
  cancelados: number;
  ambosLados: number;
  soloSat: number;
}

export interface Poliza {
  id: number;
  tipo: PolizaTipo;
  numero: number;
  fecha: string;
  concepto: string;
  ejercicio: number;
  periodo: number;
  rfc: string;
  estado: PolizaEstado;
  folio?: string | null;
  centroCosto?: string | null;
  creadoPor?: string | null;
  contabilizadoPor?: string | null;
  contabilizadaAt?: string | null;
  canceladoPor?: string | null;
  canceladaAt?: string | null;
  motivoCancelacion?: string | null;
  revertidoPor?: string | null;
  revertidaAt?: string | null;
  motivoReversion?: string | null;
  movimientos?: PolizaMovimiento[];
  cfdiSummary?: CfdiSummary;
  cfdiAlertMap?: Record<string, { satStatus?: string; erpStatus?: string; alerts: string[] }>;
  createdAt?: string;
  updatedAt?: string;
}

export interface PolizaFilter {
  rfc?: string;
  ejercicio?: number;
  periodo?: number;
  tipo?: string;
  estado?: string;
  page?: number;
  limit?: number;
}

export interface PolizaListResponse {
  total: number;
  page: number;
  limit: number;
  pages: number;
  polizas: Poliza[];
}

@Injectable({ providedIn: 'root' })
export class PolizaService {
  constructor(private api: ApiService) {}

  list(filters: PolizaFilter = {}): Observable<PolizaListResponse> {
    return this.api.get<PolizaListResponse>('/polizas', filters as Record<string, unknown>);
  }

  getById(id: number): Observable<Poliza> {
    return this.api.get<Poliza>(`/polizas/${id}`);
  }

  create(data: Partial<Poliza> & { movimientos?: Partial<PolizaMovimiento>[] }): Observable<Poliza> {
    return this.api.post<Poliza>('/polizas', data);
  }

  update(id: number, data: Partial<Poliza> & { movimientos?: Partial<PolizaMovimiento>[] }): Observable<Poliza> {
    return this.api.patch<Poliza>(`/polizas/${id}`, data);
  }

  contabilizar(id: number): Observable<Poliza> {
    return this.api.post<Poliza>(`/polizas/${id}/contabilizar`, {});
  }

  cancelar(id: number, motivo?: string): Observable<Poliza> {
    return this.api.post<Poliza>(`/polizas/${id}/cancelar`, { motivo: motivo || null });
  }

  revertir(id: number, motivo?: string): Observable<Poliza> {
    return this.api.post<Poliza>(`/polizas/${id}/revertir`, { motivo: motivo || null });
  }

  xmlSat(params: {
    rfc: string; ejercicio: number; periodo: number;
    tipoSolicitud?: string; numOrden?: string; numTramite?: string;
  }): Observable<Blob> {
    return this.api.downloadBlob('/polizas/xml-sat', params as Record<string, unknown>);
  }
}
