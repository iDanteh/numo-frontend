import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ErpService } from '../../../core/services/erp.service';
import { ErpCargaResult } from '../../../core/models/import.model';
import { PeriodoSeleccionado } from '../../../shared/components/selector-periodo-modal/selector-periodo-modal.component';
import { MESES_LABELS } from '../../../core/constants/cfdi-labels';
import { ToastService } from '../../../core/services/toast.service';
import { PeriodoActivoService } from '../../../core/services/periodo-activo.service';

@Component({
  standalone: false,
  selector: 'app-erp-api-import',
  templateUrl: './erp-api-import.component.html',
})
export class ErpApiImportComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // ── Periodo fiscal ────────────────────────────────────────────────────────
  ejercicioActual?: number;
  periodoActual?: number;
  nombrePeriodoActual = '';
  mostrarSelectorPeriodo = false;
  private pendingCarga = false;

  // ── Filtro por estatus ERP ────────────────────────────────────────────────
  readonly estatusOpciones = ['Timbrado', 'Cancelado', 'Habilitado', 'Deshabilitado', 'Cancelacion Pendiente'];
  estatusSeleccionados: Set<string> = new Set(this.estatusOpciones); // todos por defecto

  // ── Filtro por tipo de comprobante ────────────────────────────────────────
  readonly tipoOpciones: { valor: string; label: string }[] = [
    { valor: 'I', label: 'Ingreso' },
    { valor: 'E', label: 'Egreso' },
    { valor: 'P', label: 'Pago' },
    { valor: 'N', label: 'Nómina' },
  ];
  tiposSeleccionados: Set<string> = new Set(this.tipoOpciones.map(t => t.valor)); // todos por defecto

  // ── Estado de la operación ────────────────────────────────────────────────
  loading = false;
  result: ErpCargaResult | null = null;
  error = '';
  private navTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private erpService: ErpService,
    private route: ActivatedRoute,
    private router: Router,
    private toast: ToastService,
    private periodoActivoService: PeriodoActivoService,
  ) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const ej = qp.get('ejercicio');
    const pe = qp.get('periodo');
    if (ej && pe) {
      this.ejercicioActual     = +ej;
      this.periodoActual       = +pe;
      this.nombrePeriodoActual = MESES_LABELS[+pe - 1] ?? '';
    } else {
      const saved = this.periodoActivoService.snapshot;
      if (saved.ejercicio != null) {
        this.ejercicioActual = saved.ejercicio;
        if (saved.periodo != null) {
          this.periodoActual       = saved.periodo;
          this.nombrePeriodoActual = MESES_LABELS[saved.periodo - 1] ?? '';
        }
      }
    }
  }

  ngOnDestroy(): void {
    if (this.navTimer !== null) clearTimeout(this.navTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Selector de periodo ───────────────────────────────────────────────────

  abrirSelectorPeriodo(): void {
    this.mostrarSelectorPeriodo = true;
  }

  onPeriodoConfirmado(datos: PeriodoSeleccionado): void {
    this.ejercicioActual     = datos.ejercicio;
    this.periodoActual       = datos.periodo;
    this.nombrePeriodoActual = datos.nombrePeriodo;
    this.mostrarSelectorPeriodo = false;
    if (this.pendingCarga) {
      this.pendingCarga = false;
      this.cargar();
    }
  }

  // ── Filtro estatus ────────────────────────────────────────────────────────

  toggleEstatus(estatus: string): void {
    if (this.estatusSeleccionados.has(estatus)) {
      this.estatusSeleccionados.delete(estatus);
    } else {
      this.estatusSeleccionados.add(estatus);
    }
    this.estatusSeleccionados = new Set(this.estatusSeleccionados); // forzar detección de cambios
  }

  seleccionarTodos(): void {
    this.estatusSeleccionados = new Set(this.estatusOpciones);
  }

  toggleTipo(valor: string): void {
    if (this.tiposSeleccionados.has(valor)) {
      this.tiposSeleccionados.delete(valor);
    } else {
      this.tiposSeleccionados.add(valor);
    }
    this.tiposSeleccionados = new Set(this.tiposSeleccionados);
  }

  seleccionarTodosTipos(): void {
    this.tiposSeleccionados = new Set(this.tipoOpciones.map(t => t.valor));
  }

  // ── Carga desde ERP ───────────────────────────────────────────────────────

  cargar(): void {
    if (!this.ejercicioActual || !this.periodoActual) {
      this.pendingCarga = true;
      this.mostrarSelectorPeriodo = true;
      return;
    }

    this.loading = true;
    this.result  = null;
    this.error   = '';

    const filtro = this.estatusSeleccionados.size < this.estatusOpciones.length
      ? [...this.estatusSeleccionados]
      : undefined;

    const tipoFiltro = this.tiposSeleccionados.size < this.tipoOpciones.length
      ? [...this.tiposSeleccionados]
      : undefined;

    this.erpService.cargarDesdeErp(this.ejercicioActual, this.periodoActual, filtro, tipoFiltro)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.result  = res;
          this.loading = false;
          const msg = res.errores === 0
            ? `${res.nuevosInsertados} CFDIs importados correctamente`
            : `${res.nuevosInsertados} importados, ${res.errores} con errores`;
          res.errores === 0 ? this.toast.success(msg) : this.toast.warning(msg);
          if (res.nuevosInsertados > 0) {
            this.navTimer = setTimeout(() => this.router.navigate(['/ejercicios']), 2000);
          }
        },
        error: (err) => {
          const status = err?.status;
          if (status === 400) {
            this.error = err?.error?.error ?? 'Solicitud inválida. Verifica el periodo seleccionado.';
          } else if (status === 502 || status === 504) {
            this.error = err?.error?.error ?? 'No se pudo conectar con el ERP. Intenta más tarde.';
          } else if (status === 401 || status === 403) {
            this.error = 'Sin autorización. Contacta al administrador.';
          } else {
            this.error = err?.error?.error ?? 'Error inesperado al cargar desde el ERP.';
          }
          this.loading = false;
          this.toast.error(this.error);
        },
      });
  }

  // ── Helpers de template ───────────────────────────────────────────────────

  get periodoLabel(): string {
    return this.ejercicioActual
      ? `${this.nombrePeriodoActual} ${this.ejercicioActual}`
      : '';
  }

  get estadoBadge(): 'success' | 'warning' | 'danger' {
    if (!this.result) return 'success';
    if (this.result.errores === 0) return 'success';
    if (this.result.nuevosInsertados > 0) return 'warning';
    return 'danger';
  }
}
