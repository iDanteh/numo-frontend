import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyPorcentajes, LoyaltyAdjustmentReason, LoyaltySucursal,
  LoyaltySignoPermitido, LoyaltyGuardarPorcentajesPayload, LoyaltyActualizarSucursalPayload,
  LoyaltyPromotion,
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
  nuevoReason: { clave: string; nombre: string; signoPermitido: LoyaltySignoPermitido; porcentaje: number | null } =
    { clave: '', nombre: '', signoPermitido: 'AMBOS', porcentaje: null };
  reasonSaving = false;
  editingReasonId: number | null = null;
  editReason: { nombre: string; signoPermitido: LoyaltySignoPermitido; porcentaje: number | null } =
    { nombre: '', signoPermitido: 'AMBOS', porcentaje: null };

  // ── Promociones (ej. "Buen Fin") ──
  promociones: LoyaltyPromotion[] = [];
  promocionesLoading = false;
  promocionesError = '';
  showNuevaPromocion = false;
  nuevaPromocion: { nombre: string; fechaInicio: string; fechaFin: string; porcentajeBono: number | null } =
    { nombre: '', fechaInicio: '', fechaFin: '', porcentajeBono: null };
  promocionSaving = false;
  editingPromocionId: number | null = null;
  editPromocion: { nombre: string; fechaInicio: string; fechaFin: string; porcentajeBono: number | null } =
    { nombre: '', fechaInicio: '', fechaFin: '', porcentajeBono: null };

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
    this.cargarPromociones();

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

  // Texto descriptivo del signo (pedido del usuario, 2026-10-20): la tabla
  // mostraba el enum crudo (POSITIVO/NEGATIVO/AMBOS) en vez de una frase clara.
  private static readonly SIGNO_LABELS: Record<LoyaltySignoPermitido, string> = {
    POSITIVO: 'Solo valores positivos',
    NEGATIVO: 'Solo valores negativos',
    AMBOS:    'Acepta valores positivos y negativos',
  };

  signoLabel(signo: LoyaltySignoPermitido): string {
    return LealtadConfigComponent.SIGNO_LABELS[signo];
  }

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
    this.nuevoReason = { clave: '', nombre: '', signoPermitido: 'AMBOS', porcentaje: null };
    this.reasonsError = '';
    this.showNuevoReason = true;
  }

  cancelarNuevoReason(): void {
    this.showNuevoReason = false;
  }

  /** spec: un motivo con % de cálculo automático no puede tener
   *  signoPermitido:'AMBOS' (el signo final lo decide el motivo, no el
   *  usuario) — mismo mensaje que el backend, para feedback instantáneo sin
   *  round-trip. */
  private static readonly MENSAJE_PORCENTAJE_AMBOS =
    'Un motivo con % de cálculo automático no puede tener signo AMBOS — elegí POSITIVO o NEGATIVO.';

  crearReason(): void {
    if (this.reasonSaving) return;
    const clave = this.nuevoReason.clave.trim();
    const nombre = this.nuevoReason.nombre.trim();
    if (!clave || !nombre) {
      this.reasonsError = 'Clave y nombre son obligatorios.';
      return;
    }
    if (this.nuevoReason.porcentaje != null && this.nuevoReason.signoPermitido === 'AMBOS') {
      this.reasonsError = LealtadConfigComponent.MENSAJE_PORCENTAJE_AMBOS;
      return;
    }
    this.reasonsError = '';
    this.reasonSaving = true;
    this.loyalty.crearReason({
      clave, nombre, signoPermitido: this.nuevoReason.signoPermitido, porcentaje: this.nuevoReason.porcentaje,
    })
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
    this.editReason = { nombre: reason.nombre, signoPermitido: reason.signoPermitido, porcentaje: reason.porcentaje ?? null };
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
    if (this.editReason.porcentaje != null && this.editReason.signoPermitido === 'AMBOS') {
      this.reasonsError = LealtadConfigComponent.MENSAJE_PORCENTAJE_AMBOS;
      return;
    }
    this.reasonsError = '';
    this.reasonSaving = true;
    this.loyalty.editarReason(reason.id, {
      nombre, signoPermitido: this.editReason.signoPermitido, porcentaje: this.editReason.porcentaje,
    })
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

  // ── Promociones (ej. "Buen Fin") ────────────────────────────────────────

  private cargarPromociones(): void {
    this.promocionesLoading = true;
    // Administración: traer todas, activas e inactivas (mismo criterio que
    // listarReasons() en esta pantalla, sin filtro de "solo activas").
    this.loyalty.listarPromociones().pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => { this.promociones = p; this.promocionesLoading = false; },
      error: (err) => {
        this.promocionesLoading = false;
        this.promocionesError = err?.error?.error || 'No se pudo cargar el catálogo de promociones.';
      },
    });
  }

  abrirNuevaPromocion(): void {
    this.nuevaPromocion = { nombre: '', fechaInicio: '', fechaFin: '', porcentajeBono: null };
    this.promocionesError = '';
    this.showNuevaPromocion = true;
  }

  cancelarNuevaPromocion(): void {
    this.showNuevaPromocion = false;
  }

  /** Mismo criterio de validación que guardarPorcentajes(): comparación
   *  directa de string ISO 'YYYY-MM-DD' (no hace falta Date) y % en (0,100]. */
  private validarPromocion(p: { nombre: string; fechaInicio: string; fechaFin: string; porcentajeBono: number | null }): string {
    if (!p.nombre.trim()) return 'El nombre es obligatorio.';
    if (!p.fechaInicio || !p.fechaFin) return 'Captura fecha de inicio y fecha de fin.';
    if (p.fechaFin < p.fechaInicio) return 'La fecha de fin no puede ser anterior a la fecha de inicio.';
    const pct = p.porcentajeBono;
    if (pct == null || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return 'El % de bono debe ser mayor a 0 y menor o igual a 100.';
    }
    return '';
  }

  crearPromocion(): void {
    if (this.promocionSaving) return;
    const error = this.validarPromocion(this.nuevaPromocion);
    if (error) {
      this.promocionesError = error;
      return;
    }
    this.promocionesError = '';
    this.promocionSaving = true;
    this.loyalty.crearPromocion({
      nombre: this.nuevaPromocion.nombre.trim(),
      fechaInicio: this.nuevaPromocion.fechaInicio,
      fechaFin: this.nuevaPromocion.fechaFin,
      porcentajeBono: this.nuevaPromocion.porcentajeBono as number,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.promociones = [...this.promociones, p];
        this.promocionSaving = false;
        this.showNuevaPromocion = false;
      },
      error: (err) => {
        this.promocionSaving = false;
        this.promocionesError = err?.error?.error || 'No se pudo crear la promoción.';
      },
    });
  }

  iniciarEdicionPromocion(promo: LoyaltyPromotion): void {
    this.editingPromocionId = promo.id;
    this.editPromocion = {
      nombre: promo.nombre, fechaInicio: promo.fechaInicio, fechaFin: promo.fechaFin,
      porcentajeBono: promo.porcentajeBono,
    };
    this.promocionesError = '';
  }

  cancelarEdicionPromocion(): void {
    this.editingPromocionId = null;
  }

  guardarEdicionPromocion(promo: LoyaltyPromotion): void {
    if (this.promocionSaving) return;
    const error = this.validarPromocion(this.editPromocion);
    if (error) {
      this.promocionesError = error;
      return;
    }
    this.promocionesError = '';
    this.promocionSaving = true;
    this.loyalty.editarPromocion(promo.id, {
      nombre: this.editPromocion.nombre.trim(),
      fechaInicio: this.editPromocion.fechaInicio,
      fechaFin: this.editPromocion.fechaFin,
      porcentajeBono: this.editPromocion.porcentajeBono as number,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.promociones = this.promociones.map(x => x.id === p.id ? p : x);
        this.promocionSaving = false;
        this.editingPromocionId = null;
      },
      error: (err) => {
        this.promocionSaving = false;
        this.promocionesError = err?.error?.error || 'No se pudo guardar la promoción.';
      },
    });
  }

  toggleActivaPromocion(promo: LoyaltyPromotion): void {
    if (this.promocionSaving) return;
    this.promocionesError = '';
    this.promocionSaving = true;
    this.loyalty.editarPromocion(promo.id, { activa: !promo.activa }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.promociones = this.promociones.map(x => x.id === p.id ? p : x);
        this.promocionSaving = false;
      },
      error: (err) => {
        this.promocionSaving = false;
        this.promocionesError = err?.error?.error || 'No se pudo actualizar el estatus de la promoción.';
      },
    });
  }
}
