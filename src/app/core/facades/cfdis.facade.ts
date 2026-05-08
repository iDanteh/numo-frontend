import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CfdiService } from '../services/cfdi.service';
import { ErpService } from '../services/erp.service';
import { ComparisonService } from '../services/comparison.service';
import { CFDI, CFDIFilter, Discrepancy, PaginatedResponse } from '../models/cfdi.model';

/**
 * Facade para la gestión de CFDIs.
 * Los componentes interactúan únicamente con este facade,
 * sin importar directamente CfdiService.
 */
@Injectable({ providedIn: 'root' })
export class CfdisFacade {
  constructor(
    private cfdiService: CfdiService,
    private erpService: ErpService,
    private comparisonService: ComparisonService,
  ) {}

  list(filters: CFDIFilter = {}): Observable<PaginatedResponse<CFDI>> {
    return this.cfdiService.list(filters);
  }

  getById(id: string): Observable<CFDI> {
    return this.cfdiService.getById(id);
  }

  compare(id: string): Observable<unknown> {
    return this.cfdiService.compare(id);
  }

  downloadXML(id: string): Observable<Blob> {
    return this.cfdiService.downloadXML(id);
  }

  enriquecerPagos(ejercicio?: number, periodo?: number): Observable<any> {
    return this.erpService.enriquecerPagos(ejercicio, periodo);
  }

  getDiscrepanciasPorUUID(uuid: string): Observable<PaginatedResponse<Discrepancy>> {
    return this.comparisonService.listDiscrepancies({ uuid, limit: 50 });
  }

  addComentarioDiscrepancia(id: string, motivo: string, descripcion: string): Observable<{ success: boolean; comentarios: any[] }> {
    return this.comparisonService.addComentario(id, motivo, descripcion);
  }

  exportExcel(filters: CFDIFilter = {}): Observable<Blob> {
    return this.cfdiService.exportExcel(filters);
  }

  getReclasificacionPlan(ejercicio: number, periodo?: number, mesIG?: number, page = 1, limit = 20): Observable<any> {
    return this.cfdiService.getReclasificacionPlan(ejercicio, periodo, mesIG, page, limit);
  }

  aplicarReclasificacion(ejercicio: number, items?: any[]): Observable<any> {
    return this.cfdiService.aplicarReclasificacion(ejercicio, items);
  }

  erpContraparte(id: string): Observable<any> {
    return this.cfdiService.erpContraparte(id);
  }

  migrarPeriodo(id: string, ejercicio: number, periodo: number): Observable<any> {
    return this.cfdiService.migrarPeriodo(id, ejercicio, periodo);
  }

  migrarPeriodoBulk(ids: string[], ejercicio: number, periodo: number): Observable<any> {
    return this.cfdiService.migrarPeriodoBulk(ids, ejercicio, periodo);
  }
}
