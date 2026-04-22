import { Injectable, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser }                          from '@angular/common';
import { Subject, Observable }                        from 'rxjs';
import { io, Socket }                                 from 'socket.io-client';
import { environment }                                from '../../../environments/environment';

export interface RoleUpdatedEvent {
  role: string;
}

export interface BankImportProgressEvent {
  banco:      string;
  done:       number;
  total:      number;
  importados: number;
  duplicados: number;
}

export interface BankMovementUpdatedEvent {
  _id:             string;
  banco:           string;
  status:          string;
  identificadoPor: { userId: string | null; nombre: string | null; fechaId: string | null; erpId: string | null }[];
  saldoErp:        number | null;
  uuidXML:         string | null;
  erpIds:          string[];
  erpLinks:        { erpId: string; saldoActual: number | null; folioFiscal: string | null; total: number | null }[];
}

export interface ErpMatchDoneEvent {
  matched: number;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {

  private socket: Socket | null = null;

  private _roleUpdated        = new Subject<RoleUpdatedEvent>();
  private _importProgress     = new Subject<BankImportProgressEvent>();
  private _movementUpdated    = new Subject<BankMovementUpdatedEvent>();
  private _erpMatchDone       = new Subject<ErpMatchDoneEvent>();

  readonly roleUpdated$:      Observable<RoleUpdatedEvent>        = this._roleUpdated.asObservable();
  readonly importProgress$:   Observable<BankImportProgressEvent> = this._importProgress.asObservable();
  readonly movementUpdated$:  Observable<BankMovementUpdatedEvent>= this._movementUpdated.asObservable();
  readonly erpMatchDone$:     Observable<ErpMatchDoneEvent>       = this._erpMatchDone.asObservable();

  constructor(@Inject(PLATFORM_ID) private platformId: object) {}

  /** Conecta al servidor de sockets. Llamar una vez que el usuario esté autenticado. */
  connect(): void {
    if (!isPlatformBrowser(this.platformId) || this.socket?.connected) return;

    const socketUrl = environment.apiUrl.replace(/\/api$/, '');
    this.socket = io(socketUrl, { transports: ['websocket', 'polling'] });

    this.socket.on('role:updated',          (data: RoleUpdatedEvent)        => this._roleUpdated.next(data));
    this.socket.on('bank:import:progress',  (data: BankImportProgressEvent) => this._importProgress.next(data));
    this.socket.on('bank:movement:updated', (data: BankMovementUpdatedEvent)=> this._movementUpdated.next(data));
    this.socket.on('bank:erp:match:done',   (data: ErpMatchDoneEvent)       => this._erpMatchDone.next(data));
  }

  /** Envía el auth0Sub al servidor para unirse a la sala de notificaciones. */
  identify(auth0Sub: string): void {
    if (this.socket?.connected) {
      this.socket.emit('identify', auth0Sub);
    } else {
      this.socket?.once('connect', () => this.socket?.emit('identify', auth0Sub));
    }
  }

  /** Se suscribe a actualizaciones en tiempo real de un banco específico. */
  joinBanco(banco: string): void {
    this.socket?.emit('bank:join', banco);
  }

  /** Cancela la suscripción a actualizaciones de un banco. */
  leaveBanco(banco: string): void {
    this.socket?.emit('bank:leave', banco);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
