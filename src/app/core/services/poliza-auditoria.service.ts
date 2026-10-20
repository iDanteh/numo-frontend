import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  ActividadDia, CancelacionAuditoria, FiltrosAuditoria, PaginaBitacora, ResumenUsuario,
} from '../models/poliza-auditoria.model';

@Injectable({ providedIn: 'root' })
export class PolizaAuditoriaService {
  constructor(private api: ApiService) {}

  catalogos(): Observable<{ usuarios: string[]; acciones: string[] }> {
    return this.api.get('/polizas-auditoria/usuarios');
  }

  resumen(f: FiltrosAuditoria): Observable<ResumenUsuario[]> {
    return this.api.get<ResumenUsuario[]>('/polizas-auditoria/resumen', { ...f });
  }

  actividadDiaria(f: FiltrosAuditoria): Observable<ActividadDia[]> {
    return this.api.get<ActividadDia[]>('/polizas-auditoria/actividad-diaria', { ...f });
  }

  bitacora(f: FiltrosAuditoria): Observable<PaginaBitacora> {
    return this.api.get<PaginaBitacora>('/polizas-auditoria/bitacora', { ...f });
  }

  cancelaciones(f: FiltrosAuditoria): Observable<CancelacionAuditoria[]> {
    return this.api.get<CancelacionAuditoria[]>('/polizas-auditoria/cancelaciones', { ...f });
  }

  /** Reporte .xlsx con todo lo del monitor, respetando los filtros activos. */
  reporteXlsx(f: FiltrosAuditoria): Observable<Blob> {
    return this.api.downloadBlob('/polizas-auditoria/reporte.xlsx', { ...f });
  }
}
