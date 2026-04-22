import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, timer, fromEvent, EMPTY } from 'rxjs';
import { takeUntil, switchMap, filter, take, startWith, map, distinctUntilChanged } from 'rxjs/operators';
import { ComparisonFacade, CfdisFacade } from '../../core/facades';
import { MESES } from '../../core/constants/cfdi-labels';
import { PeriodoActivoService } from '../../core/services/periodo-activo.service';

const POLL_INTERVAL_MS = 30_000;

interface PeriodoFiscalCard {
  id: number;
  ejercicio: number;
  periodo: number | null;
  label?: string;
  collapsed?: boolean;  // ← AÑADIDO
  cfdis?: {
    erp: number;
    sat: number;
    total: number;
  };
  stats: {
    total: number;
    match: number;
    discrepancy: number;
    not_in_sat: number;
    cancelled: number;
    error: number;
    openDiscrepancies: number;
  };
}

interface EjercicioGroup {
  anio: number;
  card: PeriodoFiscalCard | null;   // el PeriodoFiscal con periodo=null, si existe
  meses: PeriodoFiscalCard[];
  collapsed: boolean;
}

@Component({
  standalone: false,
  selector: 'app-ejercicios',
  templateUrl: './ejercicios.component.html',
})
export class EjerciciosComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  grupos: EjercicioGroup[] = [];
  loading = false;
  silentRefreshing = false;
  lastUpdated: Date | null = null;

  // Crear ejercicio (año completo)
  showEjercicioForm = false;
  formEjercicio: number = new Date().getFullYear();
  formEjercicioError = '';
  formEjercicioSaving = false;

  // Crear periodo (mes) dentro de un ejercicio
  addingPeriodoAnio: number | null = null;
  formPeriodo: number = 1;
  formPeriodoLabel = '';
  formPeriodoError = '';
  formPeriodoSaving = false;

  batchLoading: Record<number, boolean> = {};
  batchMsg: Record<number, string> = {};
  batchTipo: Record<number, string> = {};

  readonly tiposComprobante = [
    { valor: '',  label: 'Todos los tipos' },
    { valor: 'I', label: 'I - Ingreso' },
    { valor: 'E', label: 'E - Egreso' },
    { valor: 'P', label: 'P - Pago' },
    { valor: 'N', label: 'N - Nómina' },
  ];
  deletingId: number | null = null;

  // Modal de resultados post-comparación
  mostrarModalResultado = false;
  resultadoComparacion: {
    match: number; discrepancy: number; not_in_sat: number;
    not_in_erp: number; cancelled: number; error: number; total: number;
  } | null = null;
  periodoActivo: PeriodoFiscalCard | null = null;

  // Modal de reclasificación
  mostrarModalReclasificacion = false;
  reclasificacionLoading: Record<string, boolean> = {};
  reclasificacionData: any = null;
  reclasificacionPeriodo: PeriodoFiscalCard | null = null;
  reclasificacionMigrado = false;
  migrandoPeriodo = false;

  // Panel resumen del año
  resumenAnio: EjercicioGroup | null = null;

  // Selector activo
  selectedEjercicio: number | null = null;
  selectedPeriodo: number | null = null;

  readonly currentYear = new Date().getFullYear();
  readonly ejerciciosOpciones = Array.from({ length: 10 }, (_, i) => this.currentYear - i);
  readonly meses = MESES;

  get ejerciciosDisponibles(): number[] {
    return this.grupos.map(g => g.anio);
  }

  get periodosDisponibles(): PeriodoFiscalCard[] {
    return this.grupos.find(g => g.anio === this.selectedEjercicio)?.meses ?? [];
  }

  get periodoActivoCard(): PeriodoFiscalCard | null {
    if (this.selectedEjercicio == null || this.selectedPeriodo == null) return null;
    return this.periodosDisponibles.find(p => p.periodo === this.selectedPeriodo) ?? null;
  }

  constructor(
    private comparisonFacade: ComparisonFacade,
    private cfdisFacade: CfdisFacade,
    private router: Router,
    private periodoActivoService: PeriodoActivoService,
  ) {}

  ngOnInit(): void { this.initAutoRefresh(); }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  private initAutoRefresh(): void {
    fromEvent(document, 'visibilitychange').pipe(
      map(() => !document.hidden),
      startWith(!document.hidden),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
      switchMap(visible => visible ? timer(0, POLL_INTERVAL_MS) : EMPTY),
    ).subscribe(tick => tick === 0 ? this.load() : this.silentLoad());
  }

  load(): void {
    this.loading = true;
    this.silentRefreshing = false;
    this.comparisonFacade.listPeriodosFiscales().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.grupos = this.buildGrupos(res.data ?? []);
        this.autoSelectPeriodo();
        this.loading = false;
        this.lastUpdated = new Date();
      },
      error: () => { this.loading = false; },
    });
  }

  private silentLoad(): void {
    this.silentRefreshing = true;
    this.comparisonFacade.listPeriodosFiscales().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.grupos = this.buildGrupos(res.data ?? []);
        this.silentRefreshing = false;
        this.lastUpdated = new Date();
      },
      error: () => { this.silentRefreshing = false; },
    });
  }

  private autoSelectPeriodo(): void {
    // Si ya hay un periodo activo guardado, restaurarlo si sigue siendo válido
    const saved = this.periodoActivoService.snapshot;
    if (saved.ejercicio != null) {
      const grupoGuardado = this.grupos.find(g => g.anio === saved.ejercicio);
      if (grupoGuardado) {
        this.selectedEjercicio = saved.ejercicio;
        const mesGuardado = grupoGuardado.meses.find(m => m.periodo === saved.periodo);
        this.selectedPeriodo = mesGuardado?.periodo ?? grupoGuardado.meses.sort((a, b) => (b.periodo ?? 0) - (a.periodo ?? 0))[0]?.periodo ?? null;
        this.periodoActivoService.set(this.selectedEjercicio, this.selectedPeriodo);
        return;
      }
    }
    // Seleccionar el más reciente por defecto
    if (this.selectedEjercicio != null) return;
    const grupoReciente = this.grupos[0];
    if (!grupoReciente) return;
    this.selectedEjercicio = grupoReciente.anio;
    const ultimoMes = [...grupoReciente.meses].sort((a, b) => (b.periodo ?? 0) - (a.periodo ?? 0))[0];
    this.selectedPeriodo = ultimoMes?.periodo ?? null;
    this.periodoActivoService.set(this.selectedEjercicio, this.selectedPeriodo);
  }

  onEjercicioChange(): void {
    const ultimo = [...this.periodosDisponibles].sort((a, b) => (b.periodo ?? 0) - (a.periodo ?? 0))[0];
    this.selectedPeriodo = ultimo?.periodo ?? null;
    this.periodoActivoService.set(this.selectedEjercicio, this.selectedPeriodo);
  }

  onPeriodoChange(): void {
    this.periodoActivoService.set(this.selectedEjercicio, this.selectedPeriodo);
  }

  private buildGrupos(items: PeriodoFiscalCard[]): EjercicioGroup[] {
    // Preservar estado collapsed para no perderlo al recargar
    const estadoGrupos   = new Map(this.grupos.map(g => [g.anio, g.collapsed]));
    const estadoPeriodos = new Map(
      this.grupos.flatMap(g => g.meses).map(p => [p.id, p.collapsed ?? false])
    );

    const map = new Map<number, EjercicioGroup>();
    for (const item of items) {
      if (!map.has(item.ejercicio)) {
        map.set(item.ejercicio, {
          anio: item.ejercicio,
          card: null,
          meses: [],
          collapsed: estadoGrupos.get(item.ejercicio) ?? true,
        });
      }
      const g = map.get(item.ejercicio)!;
      if (item.periodo === null) {
        g.card = item;
      } else {
        item.collapsed = estadoPeriodos.get(item.id) ?? true;
        g.meses.push(item);
      }
    }
    return [...map.values()].sort((a, b) => b.anio - a.anio);
  }

  // ── Crear ejercicio ──────────────────────────────────────────────────────────

  openEjercicioForm(): void {
    this.showEjercicioForm = true;
    this.formEjercicio = this.currentYear;
    this.formEjercicioError = '';
  }

  cancelEjercicioForm(): void { this.showEjercicioForm = false; }

  saveEjercicio(): void {
    this.formEjercicioError = '';
    if (!this.formEjercicio) { this.formEjercicioError = 'Ingresa un año válido.'; return; }
    this.formEjercicioSaving = true;
    this.comparisonFacade.createPeriodoFiscal(this.formEjercicio, null).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.formEjercicioSaving = false; this.showEjercicioForm = false; this.load(); },
      error: (err) => {
        this.formEjercicioSaving = false;
        this.formEjercicioError = err?.status === 409
          ? 'Ese ejercicio ya existe.'
          : (err?.error?.error ?? 'Error al crear el ejercicio.');
      },
    });
  }

  // ── Crear periodo (mes) ──────────────────────────────────────────────────────

  openPeriodoForm(anio: number): void {
    this.addingPeriodoAnio = anio;
    this.formPeriodo = 1;
    this.formPeriodoLabel = '';
    this.formPeriodoError = '';
  }

  cancelPeriodoForm(): void { this.addingPeriodoAnio = null; }

  savePeriodo(): void {
    if (!this.addingPeriodoAnio) return;
    this.formPeriodoError = '';
    this.formPeriodoSaving = true;
    this.comparisonFacade.createPeriodoFiscal(
      this.addingPeriodoAnio,
      this.formPeriodo,
      this.formPeriodoLabel || undefined,
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.formPeriodoSaving = false; this.addingPeriodoAnio = null; this.load(); },
      error: (err) => {
        this.formPeriodoSaving = false;
        this.formPeriodoError = err?.status === 409
          ? 'Ese periodo ya existe en este ejercicio.'
          : (err?.error?.error ?? 'Error al crear el periodo.');
      },
    });
  }

  // ── Borrado ──────────────────────────────────────────────────────────────────

  confirmDelete(id: number): void { this.deletingId = id; }
  cancelDelete(): void { this.deletingId = null; }

  doDelete(id: number): void {
    this.comparisonFacade.deletePeriodoFiscal(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.deletingId = null; this.load(); },
      error: () => { this.deletingId = null; },
    });
  }

  // ── Batch ────────────────────────────────────────────────────────────────────

  runBatch(p: PeriodoFiscalCard): void {
    this.batchLoading[p.id] = true;
    this.batchMsg[p.id] = '';
    this.periodoActivo = p;
    const tipo = this.batchTipo[p.id] || undefined;
    this.comparisonFacade.runBatch({}, p.ejercicio, p.periodo ?? undefined, tipo).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (res?.sessionId) {
          this.batchMsg[p.id] = `Comparando ${res.total ?? '?'} CFDIs...`;
          this.esperarResultados(res.sessionId.toString(), p);
        } else {
          this.batchLoading[p.id] = false;
          this.batchMsg[p.id] = 'Sin CFDIs para comparar en este periodo.';
        }
      },
      error: () => {
        this.batchLoading[p.id] = false;
        this.batchMsg[p.id] = 'Error al iniciar la comparación.';
      },
    });
  }

  private esperarResultados(sessionId: string, p: PeriodoFiscalCard): void {
    timer(5000, 5000).pipe(
      takeUntil(this.destroy$),
      switchMap(() => this.comparisonFacade.getSession(sessionId, { page: 1, limit: 1 })),
      filter(res => ['completed', 'failed'].includes((res.session as any).status)),
      take(1),
    ).subscribe({
      next: (res) => {
        this.batchLoading[p.id] = false;
        this.batchMsg[p.id] = '';
        const s = res.session as any;
        const r = s.results ?? {};
        this.resultadoComparacion = {
          match:       r.match       ?? 0,
          discrepancy: r.discrepancy ?? 0,
          not_in_sat:  r.not_in_sat  ?? 0,
          not_in_erp:  r.not_in_erp  ?? 0,
          cancelled:   r.cancelled   ?? 0,
          error:       r.error       ?? 0,
          total:       s.totalCFDIs  ?? 0,
        };
        this.mostrarModalResultado = true;
        this.load();
      },
      error: () => {
        this.batchLoading[p.id] = false;
        this.batchMsg[p.id] = 'Error al obtener resultados.';
      },
    });
  }

  cerrarModal(): void { this.mostrarModalResultado = false; }

  irAComparaciones(): void {
    if (!this.periodoActivo) return;
    const qp: Record<string, number | string> = { ejercicio: this.periodoActivo.ejercicio };
    if (this.periodoActivo.periodo != null) qp['periodo'] = this.periodoActivo.periodo;
    this.mostrarModalResultado = false;
    this.router.navigate(['/cfdis'], { queryParams: qp });
  }

  irADiscrepancias(): void {
    if (!this.periodoActivo) return;
    const qp: Record<string, number | string> = { ejercicio: this.periodoActivo.ejercicio, lastComparisonStatus: 'discrepancy' };
    if (this.periodoActivo.periodo != null) qp['periodo'] = this.periodoActivo.periodo;
    this.mostrarModalResultado = false;
    this.router.navigate(['/cfdis'], { queryParams: qp });
  }

  // ── Reclasificación Global ───────────────────────────────────────────────────

  verReclasificadas(p: PeriodoFiscalCard): void {
    this.reclasificacionLoading[p.id] = true;
    this.reclasificacionPeriodo = p;
    this.reclasificacionMigrado = false;
    // Obtener el plan (sin modificar datos) para mostrarlo antes de confirmar
    this.cfdisFacade.getReclasificacionPlan(p.ejercicio).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.reclasificacionLoading[p.id] = false;
        const data = res?.data ?? res;
        const detalle: any[] = data.detalle ?? [];
        // Pendientes: están en este periodo pero deben moverse a otro
        const pendientes = detalle
          .filter((d: any) => d.requiereReclasificacion && d.mesERP === p.periodo)
          .map((d: any) => ({
            uuid:        d.uuid,
            source:      d.source,
            mesAnterior: d.mesERP,
            mesNuevo:    d.mesCorrecto,
            anoNuevo:    d.anoCorrecto,
            motivo:      d.motivo,
          }));
        // Correctas: ya están bien en este periodo
        const correctas = detalle
          .filter((d: any) => !d.requiereReclasificacion && d.mesCorrecto === p.periodo)
          .map((d: any) => ({
            uuid:      d.uuid,
            source:    d.source,
            periodo:   d.mesCorrecto,
            ejercicio: d.anoCorrecto,
          }));
        this.reclasificacionData = {
          ...data,
          modificadas:      pendientes,
          correctas,
          totalModificados: 0,
        };
        this.mostrarModalReclasificacion = true;
      },
      error: () => {
        this.reclasificacionLoading[p.id] = false;
      },
    });
  }

  ejecutarMigracion(): void {
    if (!this.reclasificacionPeriodo || this.migrandoPeriodo) return;
    const p = this.reclasificacionPeriodo;

    // Enviar exactamente los items del plan (no re-consultar MongoDB)
    const items = (this.reclasificacionData?.modificadas ?? []).map((d: any) => ({
      uuid:        d.uuid,
      source:      d.source,
      mesCorrecto: d.mesNuevo,
      anoCorrecto: d.anoNuevo,
      mesAnterior: d.mesAnterior,
      motivo:      d.motivo,
    }));

    if (items.length === 0) return;

    this.migrandoPeriodo = true;
    this.cfdisFacade.aplicarReclasificacion(p.ejercicio, items).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.migrandoPeriodo = false;
        this.reclasificacionMigrado = true;
        const data = res?.data ?? res;
        this.reclasificacionData = {
          ...data,
          // Las modificadas ya son las que enviamos — mostrarlas todas
          modificadas: data.modificadas ?? items.map((i: any) => ({
            uuid: i.uuid, source: i.source,
            mesAnterior: i.mesAnterior, mesNuevo: i.mesCorrecto,
            anoNuevo: i.anoCorrecto, motivo: i.motivo,
          })),
          correctas: data.correctas ?? [],
        };
        this.load();
      },
      error: () => {
        this.migrandoPeriodo = false;
      },
    });
  }

  cerrarModalReclasificacion(): void {
    const fueronMigrados = this.reclasificacionMigrado;
    this.mostrarModalReclasificacion = false;
    this.reclasificacionData = null;
    this.reclasificacionMigrado = false;
    if (fueronMigrados) {
      this.load(); // Recargar contadores después de una migración real
    }
  }

  irAPeriodo(ejercicio: number, periodo: number): void {
    this.selectedEjercicio = ejercicio;
    this.selectedPeriodo   = periodo;
    this.periodoActivoService.set(ejercicio, periodo);
    this.cerrarModalReclasificacion();
  }

  // ── Navegación ───────────────────────────────────────────────────────────────

  goTo(route: string[], p: PeriodoFiscalCard): void {
    const qp: Record<string, number> = { ejercicio: p.ejercicio };
    if (p.periodo != null) qp['periodo'] = p.periodo;
    this.router.navigate(route, { queryParams: qp });
  }

  goToAnio(route: string[], anio: number): void {
    this.router.navigate(route, { queryParams: { ejercicio: anio } });
  }

  abrirResumenAnio(g: EjercicioGroup): void {
    this.resumenAnio = g;
  }

  cerrarResumenAnio(): void {
    this.resumenAnio = null;
  }

  irAComparacionesAnio(anio: number): void {
    this.resumenAnio = null;
    this.router.navigate(['/cfdis'], { queryParams: { ejercicio: anio } });
  }

  irADiscrepanciasAnio(anio: number): void {
    this.resumenAnio = null;
    this.router.navigate(['/cfdis'], { queryParams: { ejercicio: anio, lastComparisonStatus: 'discrepancy' } });
  }

  statsAnio(g: EjercicioGroup) {
    const meses = g.meses;
    const totalCfdis    = meses.reduce((s, m) => s + (m.cfdis?.total ?? 0), 0);
    const totalErp      = meses.reduce((s, m) => s + (m.cfdis?.erp   ?? 0), 0);
    const totalSat      = meses.reduce((s, m) => s + (m.cfdis?.sat   ?? 0), 0);
    const totalComp     = meses.reduce((s, m) => s + m.stats.total, 0);
    const totalMatch    = meses.reduce((s, m) => s + m.stats.match, 0);
    const totalDiscrep  = meses.reduce((s, m) => s + m.stats.discrepancy, 0);
    const totalNoSat    = meses.reduce((s, m) => s + m.stats.not_in_sat, 0);
    const totalCanceled = meses.reduce((s, m) => s + m.stats.cancelled, 0);
    const totalAbiertas = meses.reduce((s, m) => s + m.stats.openDiscrepancies, 0);
    const matchRate     = totalComp ? Math.round((totalMatch / totalComp) * 100) : 0;

    const mejorMes = [...meses].filter(m => m.stats.total > 0)
      .sort((a, b) => this.matchRate(b.stats) - this.matchRate(a.stats))[0] ?? null;
    const peorMes  = [...meses].filter(m => m.stats.total > 0)
      .sort((a, b) => this.matchRate(a.stats) - this.matchRate(b.stats))[0] ?? null;

    return { totalCfdis, totalErp, totalSat, totalComp, totalMatch, totalDiscrep,
             totalNoSat, totalCanceled, totalAbiertas, matchRate, mejorMes, peorMes };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  matchRate(s: { total: number; match: number }): number {
    return s.total ? Math.round((s.match / s.total) * 100) : 0;
  }

  barColor(rate: number): string {
    return rate >= 90 ? '#10b981' : rate >= 70 ? '#f59e0b' : '#ef4444';
  }

  mesLabel(numero: number): string {
    return this.meses[numero - 1]?.label ?? `Mes ${numero}`;
  }

  periodoLabel(p: PeriodoFiscalCard): string {
    if (p.label) return p.label;
    return p.periodo != null ? this.mesLabel(p.periodo) : `Año ${p.ejercicio}`;
  }

  mesUsado(g: EjercicioGroup, numero: number): boolean {
    return g.meses.some(m => m.periodo === numero);
  }

  mesesDisponibles(g: EjercicioGroup): typeof this.meses {
    return this.meses.filter(m => !g.meses.some(p => p.periodo === m.value));
  }
}