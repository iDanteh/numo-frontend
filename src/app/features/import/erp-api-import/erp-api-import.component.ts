import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ErpService } from '../../../core/services/erp.service';
import { ErpCargaResult } from '../../../core/models/import.model';
import { PeriodoSeleccionado } from '../../../shared/components/selector-periodo-modal/selector-periodo-modal.component';
import { MESES_LABELS } from '../../../core/constants/cfdi-labels';

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
  toastVisible = false;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private erpService: ErpService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const ej = qp.get('ejercicio');
    const pe = qp.get('periodo');
    if (ej && pe) {
      this.ejercicioActual     = +ej;
      this.periodoActual       = +pe;
      this.nombrePeriodoActual = MESES_LABELS[+pe - 1] ?? '';
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    clearTimeout(this.toastTimer);
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
    this.toastVisible = false;

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
          this.mostrarToast();
          if (res.nuevosInsertados > 0) {
            setTimeout(() => this.router.navigate(['/ejercicios']), 2000);
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
        },
      });
  }

  private mostrarToast(): void {
    this.toastVisible = true;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastVisible = false; }, 4000);
  }

  cerrarToast(): void {
    this.toastVisible = false;
    clearTimeout(this.toastTimer);
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
