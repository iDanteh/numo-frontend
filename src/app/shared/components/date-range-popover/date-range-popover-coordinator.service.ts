import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

// date-range-popover-coordinator.service.ts — asegura que solo UN
// <app-date-range-popover> quede abierto a la vez en toda la página (mismo
// criterio que el calendario compartido original en banks.component, que solo
// podía tener un contexto activo por vez al ser una única instancia). Cada
// instancia se anuncia al abrirse; las demás se cierran solas.
@Injectable({ providedIn: 'root' })
export class DateRangePopoverCoordinatorService {
  private readonly _opened$ = new Subject<symbol>();
  readonly opened$ = this._opened$.asObservable();

  notifyOpened(id: symbol): void {
    this._opened$.next(id);
  }
}
