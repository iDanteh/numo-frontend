import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ErpCargaParams, ErpCargaResult } from '../models/import.model';

/**
 * Servicio dedicado a la integración con el ERP externo.
 * Punto único de acceso al endpoint POST /api/erp/cargar.
 *
 * El backend maneja la autenticación, paginación y transformación;
 * el frontend solo envía ejercicio y periodo.
 */
@Injectable({ providedIn: 'root' })
export class ErpService {
  constructor(private api: ApiService) {}

  cargarDesdeErp(ejercicio: number, periodo: number, estatusFiltro?: string[], tipoFiltro?: string[]): Observable<ErpCargaResult> {
    const params: ErpCargaParams = { ejercicio, periodo };
    if (estatusFiltro && estatusFiltro.length > 0) params.estatusFiltro = estatusFiltro as any;
    if (tipoFiltro   && tipoFiltro.length   > 0) params.tipoFiltro    = tipoFiltro    as any;
    return this.api.post<ErpCargaResult>('/erp/cargar', params);
  }

  enriquecerPagos(ejercicio?: number, periodo?: number): Observable<any> {
    const body: Record<string, number> = {};
    if (ejercicio) body['ejercicio'] = ejercicio;
    if (periodo)   body['periodo']   = periodo;
    return this.api.post<any>('/erp/enriquecer-pagos', body);
  }

  estadoCfdi(cfdiId: string): Observable<{ encontrado: boolean; uuid: string; erpStatus: string | null; erpStatusAnterior: string | null; actualizado: boolean; mensaje?: string }> {
    return this.api.get<any>(`/erp/estado-cfdi/${cfdiId}`);
  }
}
