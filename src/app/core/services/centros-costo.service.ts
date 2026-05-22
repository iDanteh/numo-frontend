import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface CentroCosto {
  id:               number;
  clave:            string;
  sucursal:         string;
  serieFacturacion: string | null;
  isActive:         boolean;
  createdAt?:       string;
}

@Injectable({ providedIn: 'root' })
export class CentrosCostoService {
  private readonly path = '/centros-costo';

  constructor(private api: ApiService) {}

  list(includeInactive = false): Observable<CentroCosto[]> {
    return this.api.get<CentroCosto[]>(this.path, includeInactive ? { includeInactive: true } : {});
  }

  create(data: Partial<CentroCosto>): Observable<CentroCosto> {
    return this.api.post<CentroCosto>(this.path, data);
  }

  update(id: number, data: Partial<CentroCosto>): Observable<CentroCosto> {
    return this.api.patch<CentroCosto>(`${this.path}/${id}`, data);
  }

  delete(id: number): Observable<{ ok: boolean }> {
    return this.api.delete<{ ok: boolean }>(`${this.path}/${id}`);
  }
}
