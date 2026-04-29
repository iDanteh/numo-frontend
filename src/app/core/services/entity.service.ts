import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface Entity {
  id:         number;
  rfc:        string;
  nombre:     string;
  tipo:       'moral' | 'fisica';
  isActive:   boolean;
  syncConfig: {
    autoSync?:      boolean;
    syncEmitidos?:  boolean;
    syncRecibidos?: boolean;
    lastSync?:      string | null;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface EntityPayload {
  rfc:        string;
  nombre:     string;
  tipo:       'moral' | 'fisica';
  isActive:   boolean;
  syncConfig: {
    autoSync:      boolean;
    syncEmitidos:  boolean;
    syncRecibidos: boolean;
  };
}

@Injectable({ providedIn: 'root' })
export class EntityService {
  constructor(private api: ApiService) {}

  list(): Observable<Entity[]> {
    return this.api.get<Entity[]>('/entities');
  }

  create(data: EntityPayload): Observable<Entity> {
    return this.api.post<Entity>('/entities', data);
  }

  update(id: number, data: Partial<EntityPayload>): Observable<Entity> {
    return this.api.patch<Entity>(`/entities/${id}`, data);
  }
}
