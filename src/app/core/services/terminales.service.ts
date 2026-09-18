import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface Terminal {
  id:               number;
  nombreComercial:  string;
  numeroSerie:      string;
  centroCostoId:    number;
  centroCosto?:     { id: number; clave: string; sucursal: string };
  isActive:         boolean;
  createdAt?:       string;
}

@Injectable({ providedIn: 'root' })
export class TerminalesService {
  private readonly path = '/terminales';

  constructor(private api: ApiService) {}

  list(includeInactive = false): Observable<Terminal[]> {
    return this.api.get<Terminal[]>(this.path, includeInactive ? { includeInactive: true } : {});
  }

  create(data: Partial<Terminal>): Observable<Terminal> {
    return this.api.post<Terminal>(this.path, data);
  }

  update(id: number, data: Partial<Terminal>): Observable<Terminal> {
    return this.api.patch<Terminal>(`${this.path}/${id}`, data);
  }

  delete(id: number): Observable<{ ok: boolean }> {
    return this.api.delete<{ ok: boolean }>(`${this.path}/${id}`);
  }
}
