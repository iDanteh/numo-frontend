import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, interval, of } from 'rxjs';
import { switchMap, takeWhile, takeUntil, catchError } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { SatFacade } from '../../../core/facades';
import { DescargaStatus, PeriodoFiscalSimple, SatLimitesEstado } from '../../../core/models/sat.model';
import { MESES } from '../../../core/constants/cfdi-labels';
import { ToastService } from '../../../core/services/toast.service';

const POLL_INTERVAL_MS = 3000;
const PROGRESS_STEP_MS = 15000;

@Component({
  standalone: false,
  selector: 'app-descarga-manual',
  templateUrl: './descarga-manual.component.html',
})
export class DescargaManualComponent implements OnInit, OnDestroy {
  // ── Periodo fiscal ────────────────────────────────────────────────────────
  periodos: PeriodoFiscalSimple[] = [];
  ejercicios: number[] = [];
  periodosPorEjercicio: Map<number, { value: number; label: string }[]> = new Map();
  ejercicioSel: number | null = null;
  periodoSel: number | null = null;
  loadingPeriodos = false;

  // ── Formulario SAT ────────────────────────────────────────────────────────
  rfc = '';
  cerFile: File | null = null;
  keyFile: File | null = null;
  password = '';
  showPassword = false;
  fechaInicio = '';
  fechaFin = '';
  tipoComprobante: 'Emitidos' | 'Recibidos' | 'Ingresos' | 'Egresos' | 'Traslados' | 'Nomina' | 'Pagos' = 'Emitidos';

  loading = false;
  error = '';
  jobStatus: DescargaStatus | null = null;

  limites: SatLimitesEstado | null = null;
  loadingLimites = false;

  private destroy$ = new Subject<void>();
  private pollingSub: Subscription | null = null;

  readonly pasos = [
    'Registrando credenciales',
    'Autenticando con SAT',
    'Solicitando descarga',
    'Verificando estado',
    'Descargando paquetes',
    'Procesando CFDIs',
  ];

  readonly meses = MESES;

  constructor(private satFacade: SatFacade, private route: ActivatedRoute, private toast: ToastService) {}

  ngOnInit(): void {
    this.cargarPeriodos();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.pollingSub?.unsubscribe();
  }

  // ── Carga de periodos fiscales ────────────────────────────────────────────

  private cargarPeriodos(): void {
    this.loadingPeriodos = true;
    this.satFacade.listPeriodosFiscales().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.periodos = res.data ?? [];
        this.buildEjercicioMap();

        // Pre-seleccionar desde query params si vienen
        const qp = this.route.snapshot.queryParamMap;
        const ej = qp.get('ejercicio');
        const pe = qp.get('periodo');
        if (ej) {
          const ejNum = parseInt(ej, 10);
          if (this.ejercicios.includes(ejNum)) {
            this.ejercicioSel = ejNum;
            if (pe) {
              const peNum = parseInt(pe, 10);
              const mesesDisp = this.periodosPorEjercicio.get(ejNum) ?? [];
              if (mesesDisp.some(m => m.value === peNum)) {
                this.periodoSel = peNum;
              }
            }
            this.autoFillFechas();
            this.cargarLimites();
          }
        }
        this.loadingPeriodos = false;
      },
      error: () => { this.loadingPeriodos = false; },
    });
  }

  private buildEjercicioMap(): void {
    const map = new Map<number, { value: number; label: string }[]>();
    for (const p of this.periodos) {
      if (p.periodo === null) continue; // ignorar entradas de año completo
      if (!map.has(p.ejercicio)) map.set(p.ejercicio, []);
      const label = p.label ?? (this.meses.find(m => m.value === p.periodo)?.label ?? `Mes ${p.periodo}`);
      map.get(p.ejercicio)!.push({ value: p.periodo, label });
    }
    // Ordenar meses dentro de cada ejercicio
    for (const meses of map.values()) {
      meses.sort((a, b) => a.value - b.value);
    }
    this.periodosPorEjercicio = map;
    this.ejercicios = [...map.keys()].sort((a, b) => b - a);
  }

  // ── Selección de ejercicio / periodo ─────────────────────────────────────

  get mesesDelEjercicio(): { value: number; label: string }[] {
    return this.ejercicioSel ? (this.periodosPorEjercicio.get(this.ejercicioSel) ?? []) : [];
  }

  get limitesExcedidos(): boolean {
    if (!this.limites) return false;
    return this.limites.disponiblesHoy === 0 || this.limites.activas >= this.limites.limiteActivas;
  }

  cargarLimites(): void {
    const rfc = this.rfc.trim().toUpperCase();
    if (rfc.length < 12) return;
    this.loadingLimites = true;
    this.satFacade.getLimites(rfc).pipe(takeUntil(this.destroy$)).subscribe({
      next:  (res) => { this.limites = res; this.loadingLimites = false; },
      error: ()    => { this.limites = null; this.loadingLimites = false; },
    });
  }

  onEjercicioChange(): void {
    this.periodoSel = null;
    this.fechaInicio = '';
    this.fechaFin = '';
  }

  onPeriodoChange(): void {
    this.autoFillFechas();
  }

  private autoFillFechas(): void {
    if (!this.ejercicioSel || !this.periodoSel) return;
    const yr   = this.ejercicioSel;
    const mo   = this.periodoSel;
    const last = new Date(yr, mo, 0).getDate();
    this.fechaInicio = `${yr}-${String(mo).padStart(2, '0')}-01`;
    this.fechaFin    = `${yr}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  }

  // ── Estado de progreso ────────────────────────────────────────────────────

  get pasoActual(): number {
    if (!this.jobStatus) return 0;
    if (this.jobStatus.estado === 'completado') return this.pasos.length;
    if (this.jobStatus.estado === 'error') return -1;
    // Usar progreso real del backend cuando esté disponible
    if (this.jobStatus.paso !== undefined) return this.jobStatus.paso;
    // Fallback: simulación por tiempo (backends sin campo paso)
    const elapsed = Date.now() - new Date(this.jobStatus.inicio).getTime();
    return Math.min(Math.floor(elapsed / PROGRESS_STEP_MS) + 1, this.pasos.length - 1);
  }

  // ── Inicio de descarga ────────────────────────────────────────────────────

  iniciar(): void {
    this.error = '';
    this.jobStatus = null;

    const rfc = this.rfc.trim().toUpperCase();
    if (!rfc || !this.cerFile || !this.keyFile || !this.password || !this.fechaInicio || !this.fechaFin) {
      this.error = 'Todos los campos son obligatorios';
      return;
    }
    if (!this.ejercicioSel || !this.periodoSel) {
      this.error = 'Debes seleccionar un ejercicio y un periodo fiscal';
      return;
    }
    if (this.fechaInicio > this.fechaFin) {
      this.error = 'La fecha de inicio no puede ser posterior a la fecha fin';
      return;
    }

    // Validar rango máximo de 1 mes
    const diffMs   = new Date(this.fechaFin).getTime() - new Date(this.fechaInicio).getTime();
    const diffDias = diffMs / (1000 * 60 * 60 * 24);
    if (diffDias > 31) {
      this.error = 'El rango de fechas no puede exceder 1 mes por solicitud del SAT';
      return;
    }

    this.loading = true;

    this.satFacade.registrarCredenciales(rfc, this.cerFile, this.keyFile, this.password).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.password = '';  // limpiar credencial de memoria tras envío
        this.satFacade.iniciarDescargaManual({
          rfc,
          fechaInicio:     this.fechaInicio,
          fechaFin:        this.fechaFin,
          tipoComprobante: this.tipoComprobante,
          ejercicio:       this.ejercicioSel!,
          periodo:         this.periodoSel!,
        }).pipe(takeUntil(this.destroy$)).subscribe({
          next: (res) => {
            this.iniciarPolling(res.jobId);  // loading se desactiva en el primer poll
          },
          error: (err) => {
            this.loading = false;
            this.error = err?.error?.error ?? 'Error al iniciar descarga';
            this.toast.error(this.error);
          },
        });
      },
      error: (err) => {
        this.password = '';
        this.loading = false;
        this.error = err?.error?.error ?? 'Error al registrar credenciales';
        this.toast.error(this.error);
      },
    });
  }

  private iniciarPolling(jobId: string): void {
    this.pollingSub?.unsubscribe();
    this.pollingSub = interval(POLL_INTERVAL_MS).pipe(
      switchMap(() =>
        this.satFacade.statusDescarga(jobId).pipe(
          catchError(() => of(this.jobStatus!)),  // error transitorio: re-emite último estado conocido
        )
      ),
      takeWhile(s => s.estado === 'en_proceso', true),
    ).subscribe({
      next: (status) => {
        this.loading = false;
        const wasInProgress = this.jobStatus?.estado === 'en_proceso';
        this.jobStatus = status;
        if (wasInProgress && status.estado === 'completado') {
          const n = status.cfdisProcesados ?? 0;
          this.toast.success(`Descarga completada — ${n} CFDIs importados`);
        } else if (wasInProgress && status.estado === 'error') {
          this.toast.error(status.error ?? 'Error en la descarga SAT');
        }
      },
      error: () => {
        this.loading = false;
        if (this.jobStatus) {
          this.jobStatus = { ...this.jobStatus, estado: 'error', error: 'Error al consultar estado' };
          this.toast.error('Error al consultar el estado de la descarga');
        }
      },
    });
  }

  reiniciar(): void {
    this.pollingSub?.unsubscribe();
    this.jobStatus = null;
    this.error = '';
    this.password = '';
    this.cerFile = null;
    this.keyFile = null;
  }
}
