import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyPorcentajes, LoyaltyAdjustmentReason, LoyaltySucursal,
  LoyaltySignoPermitido, LoyaltyGuardarPorcentajesPayload, LoyaltyActualizarSucursalPayload,
} from '../../../core/services/loyalty.service';
import { SocketService } from '../../../core/services/socket.service';

type NivelPct = 'Bronce' | 'Plata' | 'Oro';
const NIVELES_PCT: NivelPct[] = ['Bronce', 'Plata', 'Oro'];

/**
 * Configuración de Lealtad (loyalty:config, route guard ya aplicado en
 * lealtad-routing.module.ts) — reemplaza el placeholder de PR5. spec
 * loyalty-config:
 *  - % por nivel: vía el endpoint propio de Lealtad (loyalty.service.
 *    guardarPorcentajes → PUT /loyalty/config/porcentajes), NUNCA el
 *    genérico config:manage de Configuraciones Globales (D10).
 *  - Catálogo de motivos de ajuste: crear/editar/activar-desactivar. Un
 *    motivo desactivado deja de ofrecerse en nuevos AJUSTEs (ver
 *    movimiento-modal.component.ts#activeReasons) pero las entradas
 *    históricas conservan su reasonId intacto — nunca se borra un motivo.
 *  - Flags de sucursal: participaLealtad/permiteCanjeLealtad, cada uno
 *    editable de forma independiente.
 *  - Refresco en vivo: configUpdated$ filtrado a sectionClave==='lealtad',
 *    mismo criterio que movimiento-modal.component.ts/
 *    bank-corte-panel.component.ts:74-80.
 */
@Component({
  standalone: false,
  selector: 'app-lealtad-config',
  templateUrl: './lealtad-config.component.html',
  styleUrls: ['./lealtad-config.component.css'],
})
export class LealtadConfigComponent implements OnInit, OnDestroy {
  // ── Porcentajes ──
  // number|null (no string) — mismo criterio que montoVenta/puntos en
  // movimiento-modal.component.ts: un <input type="number"> con [(ngModel)]
  // usa Angular's NumberValueAccessor, que entrega number, no string
  // (un string acá rompería .trim() en guardarPorcentajes, confirmado por un
  // test de template real que falló hasta corregir esto).
  porcentajes: LoyaltyPorcentajes | null = null;
  pctForm: Record<NivelPct, number | null> = { Bronce: null, Plata: null, Oro: null };
  pctLoading = false;
  pctSaving = false;
  pctError = '';

  // ── Catálogo de motivos ──
  reasons: LoyaltyAdjustmentReason[] = [];
  reasonsLoading = false;
  reasonsError = '';
  showNuevoReason = false;
  nuevoReason: { clave: string; nombre: string; signoPermitido: LoyaltySignoPermitido } =
    { clave: '', nombre: '', signoPermitido: 'AMBOS' };
  reasonSaving = false;
  editingReasonId: number | null = null;
  editReason: { nombre: string; signoPermitido: LoyaltySignoPermitido } = { nombre: '', signoPermitido: 'AMBOS' };

  // ── Sucursales ──
  sucursales: LoyaltySucursal[] = [];
  sucursalesLoading = false;
  sucursalesError = '';
  sucursalSavingId: number | null = null;
  // Flash de confirmación tras guardar un flag (2026-10-19) — el toggle ya
  // comunica el estado, pero no había ninguna confirmación de que el guardado
  // async terminó bien (la fila solo se re-renderizaba en silencio).
  sucursalGuardadoId: number | null = null;
  sucursalGuardadoCampo: 'participa' | 'canje' | null = null;
  private sucursalGuardadoTimeout: ReturnType<typeof setTimeout> | null = null;

  private destroy$ = new Subject<void>();

  constructor(private loyalty: LoyaltyService, private socket: SocketService) {}

  ngOnInit(): void {
    this.cargarPorcentajes();
    this.cargarReasons();
    this.cargarSucursales();

    // Si otra sesión cambia un % de Lealtad mientras esta pantalla está
    // abierta, refresca sin recargar — mismo patrón que movimiento-modal.
    this.socket.configUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ sectionClave }) => {
        if (sectionClave === 'lealtad') this.cargarPorcentajes();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.sucursalGuardadoTimeout) clearTimeout(this.sucursalGuardadoTimeout);
  }

  // ── Porcentajes ──────────────────────────────────────────────────────────

  private cargarPorcentajes(): void {
    this.pctLoading = true;
    this.loyalty.obtenerPorcentajes().pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.porcentajes = p;
        this.pctForm = { Bronce: p.Bronce, Plata: p.Plata, Oro: p.Oro };
        this.pctLoading = false;
      },
      error: (err) => {
        this.pctLoading = false;
        this.pctError = err?.error?.error || 'No se pudieron cargar los porcentajes.';
      },
    });
  }

  guardarPorcentajes(): void {
    if (this.pctSaving) return;
    const payload: LoyaltyGuardarPorcentajesPayload = {};
    for (const nivel of NIVELES_PCT) {
      const valor = this.pctForm[nivel];
      if (valor == null) continue;
      if (!Number.isFinite(valor) || valor <= 0 || valor > 100) {
        this.pctError = `El % de ${nivel} debe ser mayor a 0 y menor o igual a 100.`;
        return;
      }
      payload[nivel] = valor;
    }
    if (!Object.keys(payload).length) {
      this.pctError = 'Captura al menos un porcentaje para guardar.';
      return;
    }
    this.pctError = '';
    this.pctSaving = true;
    this.loyalty.guardarPorcentajes(payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.porcentajes = p;
        this.pctSaving = false;
      },
      error: (err) => {
        this.pctSaving = false;
        this.pctError = err?.error?.error || 'No se pudieron guardar los porcentajes.';
      },
    });
  }

  // ── Catálogo de motivos ──────────────────────────────────────────────────

  private cargarReasons(): void {
    this.reasonsLoading = true;
    this.loyalty.listarReasons().pipe(takeUntil(this.destroy$)).subscribe({
      next: (r) => { this.reasons = r; this.reasonsLoading = false; },
      error: (err) => {
        this.reasonsLoading = false;
        this.reasonsError = err?.error?.error || 'No se pudo cargar el catálogo de motivos.';
      },
    });
  }

  abrirNuevoReason(): void {
    this.nuevoReason = { clave: '', nombre: '', signoPermitido: 'AMBOS' };
    this.reasonsError = '';
    this.showNuevoReason = true;
  }

  cancelarNuevoReason(): void {
    this.showNuevoReason = false;
  }

  crearReason(): void {
    if (this.reasonSaving) return;
    const clave = this.nuevoReason.clave.trim();
    const nombre = this.nuevoReason.nombre.trim();
    if (!clave || !nombre) {
      this.reasonsError = 'Clave y nombre son obligatorios.';
      return;
    }
    this.reasonsError = '';
    this.reasonSaving = true;
    this.loyalty.crearReason({ clave, nombre, signoPermitido: this.nuevoReason.signoPermitido })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (r) => {
          this.reasons = [...this.reasons, r];
          this.reasonSaving = false;
          this.showNuevoReason = false;
        },
        error: (err) => {
          this.reasonSaving = false;
          this.reasonsError = err?.error?.error || 'No se pudo crear el motivo.';
        },
      });
  }

  iniciarEdicionReason(reason: LoyaltyAdjustmentReason): void {
    this.editingReasonId = reason.id;
    this.editReason = { nombre: reason.nombre, signoPermitido: reason.signoPermitido };
    this.reasonsError = '';
  }

  cancelarEdicionReason(): void {
    this.editingReasonId = null;
  }

  guardarEdicionReason(reason: LoyaltyAdjustmentReason): void {
    if (this.reasonSaving) return;
    const nombre = this.editReason.nombre.trim();
    if (!nombre) {
      this.reasonsError = 'El nombre es obligatorio.';
      return;
    }
    this.reasonsError = '';
    this.reasonSaving = true;
    this.loyalty.editarReason(reason.id, { nombre, signoPermitido: this.editReason.signoPermitido })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (r) => {
          this.reasons = this.reasons.map(x => x.id === r.id ? r : x);
          this.reasonSaving = false;
          this.editingReasonId = null;
        },
        error: (err) => {
          this.reasonSaving = false;
          this.reasonsError = err?.error?.error || 'No se pudo guardar el motivo.';
        },
      });
  }

  /** Activar/desactivar sin pasar por el formulario de edición — igual
   *  criterio que el toggle de "Activa" de una tarjeta (tarjeta-detail). */
  toggleActivoReason(reason: LoyaltyAdjustmentReason): void {
    if (this.reasonSaving) return;
    this.reasonSaving = true;
    this.loyalty.editarReason(reason.id, { activo: !reason.activo })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (r) => {
          this.reasons = this.reasons.map(x => x.id === r.id ? r : x);
          this.reasonSaving = false;
        },
        error: (err) => {
          this.reasonSaving = false;
          this.reasonsError = err?.error?.error || 'No se pudo actualizar el estatus del motivo.';
        },
      });
  }

  // ── Sucursales ───────────────────────────────────────────────────────────

  private cargarSucursales(): void {
    this.sucursalesLoading = true;
    this.loyalty.listarSucursales().pipe(takeUntil(this.destroy$)).subscribe({
      next: (s) => { this.sucursales = s; this.sucursalesLoading = false; },
      error: (err) => {
        this.sucursalesLoading = false;
        this.sucursalesError = err?.error?.error || 'No se pudieron cargar las sucursales.';
      },
    });
  }

  /** spec loyalty-config "Flags are set independently" — cada bandera manda
   *  SU PROPIO payload, nunca ambas juntas, para no pisar la otra con el
   *  valor que tenía en memoria si llegara a estar desactualizado. */
  toggleParticipa(sucursal: LoyaltySucursal): void {
    this.cambiarFlagSucursal(sucursal, { participaLealtad: !sucursal.participaLealtad }, 'participa');
  }

  togglePermiteCanje(sucursal: LoyaltySucursal): void {
    this.cambiarFlagSucursal(sucursal, { permiteCanjeLealtad: !sucursal.permiteCanjeLealtad }, 'canje');
  }

  private cambiarFlagSucursal(
    sucursal: LoyaltySucursal,
    payload: LoyaltyActualizarSucursalPayload,
    campo: 'participa' | 'canje',
  ): void {
    if (this.sucursalSavingId != null) return;
    this.sucursalesError = '';
    this.sucursalSavingId = sucursal.id;
    this.loyalty.actualizarSucursal(sucursal.id, payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: (s) => {
        this.sucursales = this.sucursales.map(x => x.id === s.id ? s : x);
        this.sucursalSavingId = null;
        this.mostrarGuardado(sucursal.id, campo);
      },
      error: (err) => {
        this.sucursalSavingId = null;
        this.sucursalesError = err?.error?.error || 'No se pudo actualizar la sucursal.';
      },
    });
  }

  private mostrarGuardado(id: number, campo: 'participa' | 'canje'): void {
    this.sucursalGuardadoId = id;
    this.sucursalGuardadoCampo = campo;
    if (this.sucursalGuardadoTimeout) clearTimeout(this.sucursalGuardadoTimeout);
    this.sucursalGuardadoTimeout = setTimeout(() => {
      this.sucursalGuardadoId = null;
      this.sucursalGuardadoCampo = null;
    }, 1200);
  }
}
