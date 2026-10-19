import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, merge, of, timer } from 'rxjs';
import { catchError, filter, map, switchMap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export interface AvisoCredencialesSat {
  rfc: string;
  nombre: string | null;
  estado: 'faltan' | 'por_vencer';
  expiraEn: string | null;
}

/** Cada cuánto se vuelve a preguntar al backend si sigue el aviso. */
const INTERVALO_MS = 2 * 60 * 1000;

/** Roles que ven el banner (2026-10-19, pedido del usuario: contabilidad y admin). */
export const ROLES_CON_AVISO = ['contabilidad', 'admin'];

/**
 * Banner global de credenciales SAT (2026-10-19): el backend decide CUÁNDO
 * aparece (12:00 MX del día anterior al vencimiento, o si ya faltan) — ver
 * numo-backend visor/sat/avisoVencimiento.js. Aquí solo se consulta cada
 * INTERVALO_MS y al subir credenciales (`refrescar()` desde SatService).
 */
@Injectable({ providedIn: 'root' })
export class AvisoCredencialesService {
  private readonly refrescar$ = new Subject<void>();
  private readonly avisosSubject = new BehaviorSubject<AvisoCredencialesSat[]>([]);
  readonly avisos$: Observable<AvisoCredencialesSat[]> = this.avisosSubject.asObservable();
  private iniciado = false;

  constructor(private api: ApiService, private auth: AuthService) {}

  /** Arranca el sondeo (idempotente — lo llama el componente del banner). */
  iniciar(): void {
    if (this.iniciado) return;
    this.iniciado = true;
    // roleLoaded$: el primer tick del timer corre con el rol provisional
    // ('tienda') antes de /users/me — sin esto el banner tardaba hasta
    // INTERVALO_MS en aparecer después de entrar.
    merge(timer(0, INTERVALO_MS), this.refrescar$, this.auth.roleLoaded$.pipe(filter(Boolean)))
      .pipe(
        // Solo contabilidad y admin ven el banner (2026-10-19, pedido del
        // usuario) — a los demás ni se les consulta. Se evalúa en cada tick
        // porque el rol llega después de que arranca la app.
        switchMap(() => !this.auth.hasRole(...ROLES_CON_AVISO) ? of([]) : this.api.get<{ avisos: AvisoCredencialesSat[] }>('/sat/credenciales/avisos').pipe(
          map(r => r.avisos ?? []),
          // Un error puntual (red, 401 al expirar la sesión) no debe pintar ni
          // quitar el banner — se conserva lo último conocido.
          catchError(() => of(this.avisosSubject.value)),
        )),
      )
      .subscribe(avisos => this.avisosSubject.next(avisos));
  }

  refrescar(): void {
    this.refrescar$.next();
  }
}
