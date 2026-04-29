import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface EntidadActiva {
  rfc:    string;
  nombre: string;
}

const STORAGE_KEY = 'numo_entidad_activa';

@Injectable({ providedIn: 'root' })
export class EntidadActivaService {

  private readonly _state = new BehaviorSubject<EntidadActiva | null>(this._leerStorage());

  readonly entidadActiva$ = this._state.asObservable();

  get snapshot(): EntidadActiva | null {
    return this._state.value;
  }

  set(entidad: EntidadActiva | null): void {
    this._state.next(entidad);
    try {
      if (entidad) localStorage.setItem(STORAGE_KEY, JSON.stringify(entidad));
      else         localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }

  private _leerStorage(): EntidadActiva | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as EntidadActiva;
        if (parsed?.rfc) return parsed;
      }
    } catch { /* ignore */ }
    return null;
  }
}
