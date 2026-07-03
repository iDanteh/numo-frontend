import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CollectionRequestService } from '../../core/services/collection-request.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

type TabStatus = 'pendiente' | 'autorizada' | 'rechazada';
type AuthStage = 'searching' | 'match' | 'notfound';

export interface SolicitudCobro {
  id:             string;
  cajero:         string;
  caja:           string;
  sucursal:       string;
  banco:          string;
  formaPago:      'transferencia' | 'efectivo';
  folioVenta:     string;
  cliente:        string;
  monto:          number;
  fechaSolicitud: string;   // ISO
  status:         TabStatus;
  motivoRechazo?: string;
  resueltoAt?:    string;   // ISO — fecha en que se autorizó/rechazó
}

const SOLICITUDES_MOCK: SolicitudCobro[] = [
  {
    id: '1', cajero: 'Laura Gómez Ruiz', caja: 'Caja A0', sucursal: 'Sucursal Centro',
    banco: 'BBVA', formaPago: 'transferencia', folioVenta: 'A0-260600134',
    cliente: 'Carlos Beltrán Ramírez', monto: 3826.43,
    fechaSolicitud: new Date().toISOString(), status: 'pendiente',
  },
  {
    id: '2', cajero: 'Miguel Ángel Peña', caja: 'Caja B2', sucursal: 'Sucursal Norte',
    banco: 'Santander', formaPago: 'efectivo', folioVenta: 'A0-260600141',
    cliente: 'María Fernanda Ríos', monto: 5400.00,
    fechaSolicitud: new Date().toISOString(), status: 'pendiente',
  },
  {
    id: '3', cajero: 'Sofía Hernández', caja: 'Caja A0', sucursal: 'Sucursal Centro',
    banco: 'Banorte', formaPago: 'transferencia', folioVenta: 'A0-260600147',
    cliente: 'Jorge Luis Treviño', monto: 3800.12,
    fechaSolicitud: new Date().toISOString(), status: 'pendiente',
  },
  {
    id: '4', cajero: 'Rocío García', caja: 'Caja A0', sucursal: 'Sucursal Centro',
    banco: 'BBVA', formaPago: 'transferencia', folioVenta: 'A0-260600098',
    cliente: 'Diana Salinas Ortiz', monto: 1250.00,
    fechaSolicitud: new Date(Date.now() - 86400000).toISOString(), status: 'autorizada',
    resueltoAt: new Date().toISOString(),
  },
  {
    id: '5', cajero: 'Miguel Ángel Peña', caja: 'Caja B2', sucursal: 'Sucursal Norte',
    banco: 'HSBC', formaPago: 'efectivo', folioVenta: 'A0-260600102',
    cliente: 'Ricardo Nava Peña', monto: 890.50,
    fechaSolicitud: new Date(Date.now() - 86400000).toISOString(), status: 'rechazada',
    motivoRechazo: 'No se encontró el movimiento en el banco',
    resueltoAt: new Date().toISOString(),
  },
];

const RECHAZO_MOTIVOS = [
  'No se encontró el movimiento en el banco',
  'El monto no coincide con el comprobante',
  'Comprobante ilegible o incompleto',
  'Otro motivo',
];

@Component({
  standalone: false,
  selector: 'app-collection-request',
  templateUrl: './collection-request.component.html',
})
export class CollectionRequestComponent implements OnInit, OnDestroy {

  solicitudes: SolicitudCobro[] = SOLICITUDES_MOCK.map(s => ({ ...s }));

  activeTab: TabStatus = 'pendiente';

  readonly rechazoMotivos = RECHAZO_MOTIVOS;

  // ── Modal de conciliación (buscar en banco) ────────────────────────────────
  showAuthModal   = false;
  authTarget:     SolicitudCobro | null = null;
  authStage:      AuthStage = 'searching';
  matchedMovement: any | null = null;
  showBankInline  = false;
  bankMovements:  any[] = [];
  bankLoading     = false;

  // ── Modal de rechazo ────────────────────────────────────────────────────────
  showRejectModal = false;
  rejectTarget:    SolicitudCobro | null = null;
  selectedReason:  string | null = null;
  rejectNote       = '';
  rejectShake      = false;

  private destroy$ = new Subject<void>();

  constructor(
    private svc:   CollectionRequestService,
    public  auth:  AuthService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Tabs y stats ────────────────────────────────────────────────────────────

  get filteredSolicitudes(): SolicitudCobro[] {
    return this.solicitudes.filter(s => s.status === this.activeTab);
  }

  countByStatus(status: TabStatus): number {
    return this.solicitudes.filter(s => s.status === status).length;
  }

  private isToday(iso: string | undefined): boolean {
    if (!iso) return false;
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
  }

  get autorizadasHoyCount(): number {
    return this.solicitudes.filter(s => s.status === 'autorizada' && this.isToday(s.resueltoAt)).length;
  }

  get rechazadasHoyCount(): number {
    return this.solicitudes.filter(s => s.status === 'rechazada' && this.isToday(s.resueltoAt)).length;
  }

  get montoPendienteTotal(): number {
    return this.solicitudes
      .filter(s => s.status === 'pendiente')
      .reduce((acc, s) => acc + s.monto, 0);
  }

  setTab(tab: TabStatus): void {
    this.activeTab = tab;
  }

  // ── Helpers de UI ──────────────────────────────────────────────────────────

  initials(name: string): string {
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  avatarColor(index: number): string {
    const palette = ['#3b82f6', '#0ea5a3', '#e0792b', '#d04a7a', '#8b5cf6', '#16a34a'];
    return palette[index % palette.length];
  }

  // ── Modal de conciliación ───────────────────────────────────────────────────

  openAuthModal(s: SolicitudCobro): void {
    this.authTarget      = s;
    this.matchedMovement = null;
    this.showBankInline  = false;
    this.bankMovements   = [];
    this.showAuthModal   = true;
    this.runAutoSearch();
  }

  closeAuthModal(): void {
    this.showAuthModal = false;
    this.authTarget     = null;
  }

  retrySearch(): void {
    this.runAutoSearch();
  }

  private runAutoSearch(): void {
    if (!this.authTarget) return;
    const target = this.authTarget;
    this.authStage = 'searching';

    const fechaBase = new Date(target.fechaSolicitud);
    const fechaInicio = new Date(fechaBase.getTime() - 5 * 86400000).toISOString().slice(0, 10);
    const fechaFin    = new Date(fechaBase.getTime() + 5 * 86400000).toISOString().slice(0, 10);

    this.svc.listBankMovements({
      banco:       target.banco,
      tipo:        'deposito',
      fechaInicio,
      fechaFin,
      limit:       50,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.bankMovements = res.data || [];
        const exact = this.bankMovements.find(m => Math.abs((m.deposito ?? 0) - target.monto) < 1);
        if (exact) {
          this.matchedMovement = exact;
          this.authStage = 'match';
        } else {
          this.authStage = 'notfound';
        }
      },
      error: () => {
        this.bankMovements = [];
        this.authStage = 'notfound';
      },
    });
  }

  toggleBankInline(): void {
    this.showBankInline = !this.showBankInline;
  }

  askAuthorize(): void {
    if (!this.authTarget || !this.matchedMovement) return;
    const s = this.authTarget;
    const ok = confirm(
      `Se identificará el movimiento en el banco y se autorizará el cobro de la venta ${s.folioVenta} por ` +
      `${this.formatMoney(s.monto)}. La acción quedará registrada.\n\n¿Autorizar e identificar?`,
    );
    if (ok) this.authorizeSolicitud();
  }

  identifyMovement(mov: any): void {
    if (!this.authTarget) return;
    const s = this.authTarget;
    const ok = confirm(
      `Se vinculará este movimiento del banco con la venta ${s.folioVenta} por ${this.formatMoney(s.monto)} ` +
      `y se autorizará el cobro.\n\n¿Continuar?`,
    );
    if (ok) { this.matchedMovement = mov; this.authorizeSolicitud(); }
  }

  relateMovement(mov: any): void {
    if (!this.authTarget) return;
    const s = this.authTarget;
    const diff = (mov.deposito ?? 0) - s.monto;
    let detail: string;
    if (Math.abs(diff) < 0.005) {
      detail = 'El monto coincide con la cuenta por cobrar.';
    } else if (diff > 0) {
      detail = `El movimiento es mayor que la cuenta por cobrar por ${this.formatMoney(Math.abs(diff))}.`;
    } else {
      detail = `El movimiento es menor que la cuenta por cobrar por ${this.formatMoney(Math.abs(diff))}. Se registrará como pago parcial.`;
    }
    const ok = confirm(
      `${detail}\nSe relacionará la venta ${s.folioVenta} (${this.formatMoney(s.monto)}) con este movimiento ` +
      `del banco (${this.formatMoney(mov.deposito ?? 0)}).\n\n¿Relacionar?`,
    );
    if (ok) { this.matchedMovement = mov; this.authorizeSolicitud(); }
  }

  private authorizeSolicitud(): void {
    if (!this.authTarget) return;
    const s = this.authTarget;
    s.status     = 'autorizada';
    s.resueltoAt = new Date().toISOString();
    this.closeAuthModal();
    this.toast.success(
      `Se identificó y concilió el cobro de la venta ${s.folioVenta} por ${this.formatMoney(s.monto)} en ${s.banco}.`,
    );
  }

  private formatMoney(n: number): string {
    return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  // ── Modal de rechazo ────────────────────────────────────────────────────────

  rejectFromAuthModal(): void {
    const preset = this.authStage === 'notfound' ? RECHAZO_MOTIVOS[0] : undefined;
    const target = this.authTarget;
    this.closeAuthModal();
    if (target) this.openRejectModal(target, preset);
  }

  openRejectModal(s: SolicitudCobro, presetReason?: string): void {
    this.rejectTarget   = s;
    this.selectedReason = presetReason || null;
    this.rejectNote      = '';
    this.showRejectModal = true;
  }

  closeRejectModal(): void {
    this.showRejectModal = false;
    this.rejectTarget     = null;
  }

  selectReason(reason: string): void {
    this.selectedReason = reason;
  }

  askReject(): void {
    if (!this.rejectTarget) return;
    if (!this.selectedReason) {
      this.rejectShake = true;
      setTimeout(() => this.rejectShake = false, 300);
      return;
    }
    const s = this.rejectTarget;
    const ok = confirm(
      `Se rechazará la solicitud de la venta ${s.folioVenta} y se notificará al cajero ${s.cajero}.\n` +
      `Motivo: ${this.selectedReason}.\n\n¿Rechazar?`,
    );
    if (ok) this.rejectSolicitud();
  }

  private rejectSolicitud(): void {
    if (!this.rejectTarget || !this.selectedReason) return;
    const s = this.rejectTarget;
    s.status        = 'rechazada';
    s.motivoRechazo = this.selectedReason;
    s.resueltoAt    = new Date().toISOString();
    this.toast.error(`Se rechazó la solicitud de la venta ${s.folioVenta}. Se notificó a ${s.cajero}.`);
    this.closeRejectModal();
  }
}
