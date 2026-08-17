import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, interval } from 'rxjs';
import { switchMap, tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export interface Notificacion {
  id:        number;
  tipo:      string;
  titulo:    string;
  mensaje:   string | null;
  polizaId:  number | null;
  cfdiUuid:  string | null;
  leida:      boolean;
  leidaPor:   string | null;
  leidaAt:    string | null;
  resuelta:   boolean;
  resueltaPor: string | null;
  resueltaAt:  string | null;
  createdAt:  string;
}

export interface NotificacionesResponse {
  items:    Notificacion[];
  noLeidas: number;
}

// Cada cuánto se refresca la bandeja mientras la sesión está activa — el job
// que las genera corre cada hora (ver cfdiCanceladoNotificacionJob.js), no
// hace falta un polling más agresivo que eso.
const INTERVALO_POLLING_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private itemsSubject    = new BehaviorSubject<Notificacion[]>([]);
  private noLeidasSubject = new BehaviorSubject<number>(0);
  readonly items$    = this.itemsSubject.asObservable();
  readonly noLeidas$ = this.noLeidasSubject.asObservable();

  private pollingSub: Subscription | null = null;

  constructor(private api: ApiService, private auth: AuthService) {
    // Solo hace polling mientras hay sesión — evita 401 en loop cuando el
    // usuario no ha iniciado sesión o cerró sesión.
    this.auth.isAuthenticated$.subscribe(autenticado => {
      if (autenticado) this.iniciarPolling();
      else this.detenerPolling();
    });
  }

  private iniciarPolling(): void {
    if (this.pollingSub) return;
    this.pollingSub = interval(INTERVALO_POLLING_MS).pipe(
      switchMap(() => this.list()),
    ).subscribe();
    this.refrescar();
  }

  private detenerPolling(): void {
    this.pollingSub?.unsubscribe();
    this.pollingSub = null;
    this.itemsSubject.next([]);
    this.noLeidasSubject.next(0);
  }

  /** Fuerza un refresco inmediato (ej. al abrir el dropdown de la campana). */
  refrescar(): void {
    this.list().subscribe();
  }

  private list(): Observable<NotificacionesResponse> {
    return this.api.get<NotificacionesResponse>('/notificaciones').pipe(
      tap((res) => {
        this.itemsSubject.next(res.items);
        this.noLeidasSubject.next(res.noLeidas);
      }),
      // Silencioso — un fallo de polling no debe generar ruido ni romper el
      // interval (un error sin catch aquí cancelaría el polling para siempre).
      catchError(() => of({ items: this.itemsSubject.value, noLeidas: this.noLeidasSubject.value })),
    );
  }

  marcarLeida(id: number): Observable<Notificacion> {
    return this.api.post<Notificacion>(`/notificaciones/${id}/marcar-leida`, {}).pipe(
      tap(() => this.refrescar()),
    );
  }

  marcarTodasLeidas(): Observable<{ actualizadas: number }> {
    return this.api.post<{ actualizadas: number }>('/notificaciones/marcar-todas-leidas', {}).pipe(
      tap(() => this.refrescar()),
    );
  }

  /** A diferencia de marcarLeida, esta SÍ saca la notificación de la bandeja
   *  — usar solo cuando el problema real ya se atendió. */
  marcarResuelta(id: number): Observable<Notificacion> {
    return this.api.post<Notificacion>(`/notificaciones/${id}/marcar-resuelta`, {}).pipe(
      tap(() => this.refrescar()),
    );
  }
}
