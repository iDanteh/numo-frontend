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

  downloadXML(id: string): void {
    window.open(`${this.api.base}/cfdis/${id}/xml`, '_blank');
  }

  exportExcel(filters: CFDIFilter = {}): Observable<Blob> {
    return this.api.downloadBlob('/cfdis/export', filters as Record<string, unknown>);
  }
}
