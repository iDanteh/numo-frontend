import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface PeriodoActivo {
  ejercicio: number | null;
  periodo:   number | null;
}

const STORAGE_KEY = 'numo_periodo_activo';

@Injectable({ providedIn: 'root' })
export class PeriodoActivoService {

  private readonly _state = new BehaviorSubject<PeriodoActivo>(this._leerStorage());

  readonly periodoActivo$ = this._state.asObservable();

  get snapshot(): PeriodoActivo {
    return this._state.value;
  }

  set(ejercicio: number | null, periodo: number | null): void {
    const val: PeriodoActivo = { ejercicio, periodo };
    this._state.next(val);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(val)); } catch { /* ignore */ }
  }

  /** Se llama al cerrar sesión: la próxima sesión vuelve a arrancar en el mes/año actual. */
  clear(): void {
    const val = this._defaultActual();
    this._state.next(val);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  private _defaultActual(): PeriodoActivo {
    const hoy = new Date();
    return { ejercicio: hoy.getFullYear(), periodo: hoy.getMonth() + 1 };
  }

  private _leerStorage(): PeriodoActivo {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PeriodoActivo;
        if (parsed?.ejercicio) return parsed;
      }
    } catch { /* ignore */ }
    return this._defaultActual();
  }
}
