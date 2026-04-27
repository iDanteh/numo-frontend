import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { CFDI, CFDIFilter, PaginatedResponse } from '../models/cfdi.model';

@Injectable({ providedIn: 'root' })
export class CfdiService {
  constructor(private api: ApiService) {}

  list(filters: CFDIFilter = {}): Observable<PaginatedResponse<CFDI>> {
    return this.api.get<PaginatedResponse<CFDI>>('/cfdis', filters as Record<string, unknown>);
  }

  getById(id: string): Observable<CFDI> {
    return this.api.get<CFDI>(`/cfdis/${id}`);
  }

  compare(id: string): Observable<any> {
    return this.api.post(`/cfdis/${id}/compare`, {});
  }

  verifySAT(uuid: string, rfcEmisor: string, rfcReceptor: string, total: number): Observable<any> {
    return this.api.post('/sat/verify', { uuid, rfcEmisor, rfcReceptor, total });
  }

  getSATStatus(uuid: string): Observable<any> {
    return this.api.get(`/sat/status/${uuid}`);
  }

  downloadXML(id: string, uuid?: string): Observable<Blob> {
    return this.api.downloadBlob(`/cfdis/${id}/xml`);
  }

  exportExcel(filters: CFDIFilter = {}): Observable<Blob> {
    return this.api.downloadBlob('/cfdis/export', filters as Record<string, unknown>);
  }

  getReclasificacionPlan(ejercicio: number, periodo?: number, mesIG?: number): Observable<any> {
    const params: Record<string, unknown> = { ejercicio };
    if (periodo != null) params['periodo'] = periodo;
    if (mesIG   != null) params['mesIG']   = mesIG;
    return this.api.get<any>('/cfdis/reclasificacion-global/plan', params);
  }

  aplicarReclasificacion(ejercicio: number, items?: any[]): Observable<any> {
    const body: any = { confirmar: true, ejercicio };
    if (items && items.length > 0) body['items'] = items;
    return this.api.post<any>('/cfdis/reclasificacion-global/aplicar', body);
  }

  migrarPeriodo(id: string, ejercicio: number, periodo: number): Observable<any> {
    return this.api.patch<any>(`/cfdis/${id}/migrar-periodo`, { ejercicio, periodo });
  }

  migrarPeriodoBulk(ids: string[], ejercicio: number, periodo: number): Observable<any> {
    return this.api.post<any>('/cfdis/migrar-periodo-bulk', { ids, ejercicio, periodo });
  }
}
