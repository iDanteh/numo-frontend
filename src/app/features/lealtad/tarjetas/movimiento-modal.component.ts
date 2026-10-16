import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyCard, LoyaltySucursal, LoyaltyAdjustmentReason, LoyaltyPorcentajes,
  LoyaltyMovimientoResult,
} from '../../../core/services/loyalty.service';
import { SocketService } from '../../../core/services/socket.service';

export type MovimientoMode = 'acumulacion' | 'canje' | 'ajuste';

/**
 * Registro de ACUMULACION/CANJE/AJUSTE (spec loyalty-points-ledger). Un solo
 * componente para los 3 modos — comparten layout (modal + monto/puntos +
 * centro de costo o reason) y el mismo manejo de error del backend.
 * Preview de puntos en vivo (acumulacion): snapshot del % del nivel, igual
 * criterio de refresco que bank-corte-panel.component.ts (configUpdated$
 * filtrado por sectionClave==='lealtad', D11: sin % configurado el preview
 * es null, igual que el backend rechazaría con 422).
 */
@Component({
  standalone: false,
  selector: 'app-movimiento-modal',
  templateUrl: './movimiento-modal.component.html',
  styleUrls: ['./movimiento-modal.component.css'],
})
export class MovimientoModalComponent implements OnInit, OnDestroy {
  @Input() card!: LoyaltyCard;
  @Input() mode!: MovimientoMode;

  @Output() registered = new EventEmitter<LoyaltyMovimientoResult>();
  @Output() closed     = new EventEmitter<void>();

  sucursales: LoyaltySucursal[] = [];
  reasons: LoyaltyAdjustmentReason[] = [];
  porcentajes: LoyaltyPorcentajes | null = null;

  montoVenta: number | null = null;
  puntos: number | null = null;
  centroCostoId: number | null = null;
  reasonId: number | null = null;
  justificacion = '';

  saving = false;
  error = '';

  private destroy$ = new Subject<void>();

  constructor(private loyalty: LoyaltyService, private socket: SocketService) {}

  ngOnInit(): void {
    if (this.mode === 'ajuste') {
      this.loyalty.listarReasons().pipe(takeUntil(this.destroy$)).subscribe(r => this.reasons = r);
      return;
    }
    this.loyalty.listarSucursales().pipe(takeUntil(this.destroy$)).subscribe(s => this.sucursales = s);
    if (this.mode === 'acumulacion') {
      this.cargarPorcentajes();
      this.socket.configUpdated$.pipe(takeUntil(this.destroy$)).subscribe(({ sectionClave }) => {
        if (sectionClave === 'lealtad') this.cargarPorcentajes();
      });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private cargarPorcentajes(): void {
    this.loyalty.obtenerPorcentajes().pipe(takeUntil(this.destroy$)).subscribe(p => this.porcentajes = p);
  }

  /** Preview informativo — el cálculo final (y la validación de % faltante,
   *  D11) siempre los confirma el backend al registrar. */
  puntosPreview(): number | null {
    if (!this.porcentajes || !this.montoVenta || this.montoVenta <= 0) return null;
    const pct = this.porcentajes[this.card.nivel];
    if (pct == null) return null;
    return Math.round(this.montoVenta * pct) / 100;
  }

  guardar(): void {
    if (this.saving) return;
    if (this.mode === 'acumulacion') return this.guardarAcumulacion();
    if (this.mode === 'canje')       return this.guardarCanje();
    return this.guardarAjuste();
  }

  private guardarAcumulacion(): void {
    if (!this.montoVenta || this.montoVenta <= 0) {
      this.error = 'El monto de venta debe ser mayor a cero.';
      return;
    }
    if (!this.centroCostoId) {
      this.error = 'Selecciona una sucursal.';
      return;
    }
    this.enviar(this.loyalty.registrarAcumulacion(this.card.id, {
      montoVenta: this.montoVenta, centroCostoId: this.centroCostoId,
    }));
  }

  private guardarCanje(): void {
    if (!this.puntos || this.puntos <= 0) {
      this.error = 'Los puntos a canjear deben ser mayores a cero.';
      return;
    }
    if (this.puntos > this.card.saldoPuntos) {
      this.error = 'El canje no puede exceder el saldo de la tarjeta.';
      return;
    }
    if (!this.centroCostoId) {
      this.error = 'Selecciona una sucursal.';
      return;
    }
    this.enviar(this.loyalty.registrarCanje(this.card.id, {
      puntos: this.puntos, centroCostoId: this.centroCostoId,
    }));
  }

  private guardarAjuste(): void {
    if (!this.puntos || this.puntos === 0) {
      this.error = 'Captura los puntos del ajuste (positivos o negativos).';
      return;
    }
    if (!this.reasonId) {
      this.error = 'Selecciona un motivo.';
      return;
    }
    if (!this.justificacion.trim() || this.justificacion.trim().length < 5) {
      this.error = 'La justificación es obligatoria (mínimo 5 caracteres).';
      return;
    }
    this.enviar(this.loyalty.registrarAjuste(this.card.id, {
      puntos: this.puntos, reasonId: this.reasonId, justificacion: this.justificacion.trim(),
    }));
  }

  private enviar(obs: ReturnType<LoyaltyService['registrarAcumulacion']>): void {
    this.error = '';
    this.saving = true;
    obs.pipe(takeUntil(this.destroy$)).subscribe({
      next: (result) => {
        this.saving = false;
        this.registered.emit(result);
      },
      error: (err) => {
        this.saving = false;
        this.error = err?.error?.error || 'No se pudo registrar el movimiento.';
      },
    });
  }
}
