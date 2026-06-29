import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface ClienteCatalogo {
  id:        number;
  cuenta:    string;
  nombre:    string;
  tipo:      'CLIENTE' | 'PROVEEDOR' | 'CLIENTE-PROVEEDOR';
  rfc:       string;
  isActive:  boolean;
  createdAt?: string;
}

@Injectable({ providedIn: 'root' })
export class ClientesCatalogoService {
  private readonly path = '/clientes';

  constructor(private api: ApiService) {}

  list(params: { search?: string; tipo?: string; includeInactive?: boolean } = {}): Observable<ClienteCatalogo[]> {
    return this.api.get<ClienteCatalogo[]>(this.path, params as Record<string, unknown>);
  }

  create(data: Partial<ClienteCatalogo>): Observable<ClienteCatalogo> {
    return this.api.post<ClienteCatalogo>(this.path, data);
  }

  update(id: number, data: Partial<ClienteCatalogo>): Observable<ClienteCatalogo> {
    return this.api.patch<ClienteCatalogo>(`${this.path}/${id}`, data);
  }

  delete(id: number): Observable<{ ok: boolean }> {
    return this.api.delete<{ ok: boolean }>(`${this.path}/${id}`);
  }

  import(file: File): Observable<ClienteImportResult> {
    return this.api.uploadFiles<ClienteImportResult>(`${this.path}/import`, [file], 'file');
  }
}

export interface ClienteImportResult {
  inserted: number;
  updated:  number;
  errors:   { fila: number; rfc: string; error: string }[];
}
