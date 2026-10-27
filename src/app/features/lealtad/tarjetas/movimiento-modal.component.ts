import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyCard, LoyaltyAdjustmentReason, LoyaltyMovimientoResult,
} from '../../../core/services/loyalty.service';
import { SERIE_FOLIO_RE, SERIE_RE } from '../lealtad.constants';

export type MovimientoMode = 'acumulacion' | 'canje' | 'ajuste';

/**
 * Registro de ACUMULACION/CANJE/AJUSTE (spec loyalty-points-ledger). Un solo
 * componente para los 3 modos.
 *
 * ACUMULACION/CANJE (2026-10-21, pedido explícito del usuario) ya no piden un
 * select de sucursal ni (en ACUMULACION) un monto de venta libre: el cajero
 * solo captura la serie de Kore (sola en CANJE, con folio en ACUMULACION
 * como "SERIE-FOLIO"). El backend resuelve la sucursal y, en ACUMULACION,
 * consulta la venta real en Kore para calcular los puntos — por eso ya no
 * hay preview en vivo del lado del cliente (el monto no se conoce hasta que
 * el backend responde).
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

  reasons: LoyaltyAdjustmentReason[] = [];

  // ACUMULACION: Serie-Folio de la venta en Kore (ej. "A0-260605320").
  serieFolio: string | null = null;
  // CANJE: solo la serie de la sucursal (ej. "A0").
  serie: string | null = null;
  puntos: number | null = null;
  reasonId: number | null = null;
  justificacion = '';

  saving = false;
  error = '';

  private destroy$ = new Subject<void>();

  constructor(private loyalty: LoyaltyService) {}

  ngOnInit(): void {
    if (this.mode === 'ajuste') {
      this.loyalty.listarReasons().pipe(takeUntil(this.destroy$)).subscribe(r => this.reasons = r);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** PR7: un motivo desactivado (configuracion/lealtad-config.component) no
   *  debe ofrecerse para un AJUSTE nuevo (spec loyalty-config "Deactivated
   *  reason is hidden from new adjustments") — el backend ya lo rechaza,
   *  esto evita que el usuario lo intente siquiera. */
  activeReasons(): LoyaltyAdjustmentReason[] {
    return this.reasons.filter(r => r.activo);
  }

  selectedReason(): LoyaltyAdjustmentReason | null {
    return this.reasons.find(r => r.id === this.reasonId) ?? null;
  }

  /** Rediseño 2026-10-23 (reemplaza el % sobre montoBase): el valor que se va a aplicar ya está
   *  fijo en el motivo, no hace falta ningún cálculo — se muestra tal cual. */
  ajustePreview(): number | null {
    return this.selectedReason()?.puntosFijos ?? null;
  }

  /** Al cambiar a un motivo con puntosFijos, limpia el campo manual que ya no aplica — evita que
   *  un valor viejo oculto se mande por error (aunque el backend lo ignoraría igual). */
  onReasonChange(): void {
    if (this.selectedReason()?.puntosFijos != null) {
      this.puntos = null;
    }
  }

  guardar(): void {
    if (this.saving) return;
    if (this.mode === 'acumulacion') return this.guardarAcumulacion();
    if (this.mode === 'canje')       return this.guardarCanje();
    return this.guardarAjuste();
  }

  private guardarAcumulacion(): void {
    const serieFolio = (this.serieFolio ?? '').trim();
    if (!SERIE_FOLIO_RE.test(serieFolio)) {
      this.error = 'Captura el Serie-Folio de la venta en formato SERIE-FOLIO (ej. A0-260605320).';
      return;
    }
    this.enviar(this.loyalty.registrarAcumulacion(this.card.id, { serieFolio }));
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
    const serie = (this.serie ?? '').trim();
    if (!SERIE_RE.test(serie)) {
      this.error = 'Captura la serie de la sucursal (ej. A0).';
      return;
    }
    this.enviar(this.loyalty.registrarCanje(this.card.id, { puntos: this.puntos, serie }));
  }

  private guardarAjuste(): void {
    if (!this.reasonId) {
      this.error = 'Selecciona un motivo.';
      return;
    }
    if (!this.justificacion.trim() || this.justificacion.trim().length < 5) {
      this.error = 'La justificación es obligatoria (mínimo 5 caracteres).';
      return;
    }
    const reason = this.selectedReason();
    if (reason?.puntosFijos != null) {
      // Motivo con valor fijo: se aplica tal cual, no hace falta nada más del usuario.
      this.enviar(this.loyalty.registrarAjuste(this.card.id, {
        reasonId: this.reasonId, justificacion: this.justificacion.trim(),
      }));
      return;
    }
    if (!this.puntos || this.puntos === 0) {
      this.error = 'Captura los puntos del ajuste (positivos o negativos).';
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
