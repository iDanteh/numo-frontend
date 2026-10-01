import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, combineLatest, Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { Notificacion, NotificationService } from '../../core/services/notification.service';

@Component({
  standalone: false,
  selector:   'app-notification-bell',
  templateUrl: './notification-bell.component.html',
  styleUrls:  ['./notification-bell.component.css'],
})
export class NotificationBellComponent {
  open = false;

  readonly items$:     Observable<Notificacion[]>;
  readonly noLeidas$:  Observable<number>;
  readonly hasUnread$: Observable<boolean>;

  // Cuántas no leídas ya "vio" el usuario al abrir el desplegable — el pulso
  // del ícono y el banner se apagan con solo abrirlo, SIN depender de que se
  // marquen como leídas/resueltas en el backend (eso sigue siendo un estado
  // de negocio aparte). Si llegan notificaciones nuevas después, vuelve a
  // activarse porque noLeidas supera a este valor otra vez.
  private readonly vistasHasta$ = new BehaviorSubject<number>(0);

  constructor(private notificationSvc: NotificationService, private router: Router) {
    this.items$ = this.notificationSvc.items$;
    this.noLeidas$ = this.notificationSvc.noLeidas$;
    this.hasUnread$ = combineLatest([this.noLeidas$, this.vistasHasta$]).pipe(
      map(([noLeidas, vistasHasta]) => noLeidas > vistasHasta),
    );
  }

  toggle(): void {
    this.open = !this.open;
    if (this.open) {
      this.notificationSvc.refrescar();
      this.noLeidas$.pipe(take(1)).subscribe(n => this.vistasHasta$.next(n));
    }
  }

  close(): void {
    this.open = false;
  }

  /** Clic en una notificación: marca como leída y, si trae póliza, navega a
   *  abrirla — openEdit() en poliza-list.component solo necesita el id, así
   *  que sirve sin importar si es vista Ingreso o Cobranza. */
  abrirNotificacion(n: Notificacion): void {
    if (!n.leida) this.notificationSvc.marcarLeida(n.id).subscribe();
    this.close();
    if (n.polizaId) {
      this.router.navigate(['/polizas'], { queryParams: { polizaId: n.polizaId } });
    }
  }

  marcarTodasLeidas(): void {
    this.notificationSvc.marcarTodasLeidas().subscribe();
  }

  /** Distinto de abrirNotificacion: esta SÍ la saca de la bandeja — el
   *  problema real ya se atendió (reversión hecha, sustituto incorporado,
   *  etc.), no solo "ya la vi". */
  marcarResuelta(n: Notificacion, event: Event): void {
    event.stopPropagation();
    this.notificationSvc.marcarResuelta(n.id).subscribe();
  }
}
