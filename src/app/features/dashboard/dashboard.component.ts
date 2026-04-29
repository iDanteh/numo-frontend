import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject, Subscription, interval } from 'rxjs';
import { takeUntil, switchMap, takeWhile, skip } from 'rxjs/operators';
import { ComparisonFacade } from '../../core/facades';
import { DashboardKPIs, Discrepancy, DiscrepanciaMonto, CfdiStatusMismatch, PagosRelacionadosStats } from '../../core/models/cfdi.model';
import { DISCREPANCY_TYPE_LABEL, MESES_LABELS } from '../../core/constants/cfdi-labels';
import { ToastService } from '../../core/services/toast.service';
import { PeriodoActivoService } from '../../core/services/periodo-activo.service';
import { EntidadActivaService } from '../../core/services/entidad-activa.service';

@Component({
  standalone: false,
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private destroy$    = new Subject<void>();
  private pollingSub: Subscription | null = null;
  comparacionEnCurso  = false;
  kpis: DashboardKPIs | null = null;
  topDiscrepancyTypes: any[] = [];
  recentDiscrepancies: Discrepancy[] = [];
  readonly discrepancyTypeLabel = DISCREPANCY_TYPE_LABEL;
  loading = true;
  error: string | null = null;

  ejercicioSeleccionado?: number;
  periodoSeleccionado?: number;
  tipoSeleccionado?: string;
  rfcEmisorSeleccionado?: string;
  readonly anioActual = new Date().getFullYear();
  readonly ejercicios = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
  readonly meses = MESES_LABELS.map((nombre, i) => ({ valor: i + 1, nombre }));
  readonly tipos = [
    { valor: 'I', label: 'I - Ingreso' },
    { valor: 'E', label: 'E - Egreso' },
    { valor: 'P', label: 'P - Pago' },
    { valor: 'T', label: 'T - Traslado' },
    { valor: 'N', label: 'N - Nómina' },
  ];

  readonly donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const, labels: { font: { size: 11 }, boxWidth: 10, padding: 8 } },
    },
  };

  readonly barHOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y' as const,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: { ticks: { font: { size: 10 } } },
      y: { ticks: { font: { size: 11 } } },
    },
  };

  satStatusChartData: any    = { datasets: [], labels: [] };
  conciliationChartData: any = { datasets: [], labels: [] };
  amountsChartData: any      = { datasets: [], labels: [] };

  constructor(
    private comparisonFacade: ComparisonFacade,
    private toast: ToastService,
    private periodoActivoService: PeriodoActivoService,
    private entidadActivaService: EntidadActivaService,
  ) {}

  ngOnInit(): void {
    const saved = this.periodoActivoService.snapshot;
    if (saved.ejercicio != null) {
      this.ejercicioSeleccionado = saved.ejercicio;
      if (saved.periodo != null) this.periodoSeleccionado = saved.periodo;
    }
    this.rfcEmisorSeleccionado = this.entidadActivaService.snapshot?.rfc ?? undefined;
    // Recargar automáticamente cuando cambie la entidad activa desde otra vista
    this.entidadActivaService.entidadActiva$.pipe(skip(1), takeUntil(this.destroy$)).subscribe(entidad => {
      this.rfcEmisorSeleccionado = entidad?.rfc ?? undefined;
      this.loadDashboard();
    });
    this.loadDashboard();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.pollingSub?.unsubscribe();
  }

  loadDashboard(): void {
    this.loading = true;
    this.notInErpItems    = [];
    this.notInErpTotal    = 0;
    this.duplicadosSAT    = [];
    this.matchOtroPeriodo = [];
    this.discrepanciasCriticas    = [];
    this.criticasCancelados      = [];
    this.criticasDeshabilitados  = [];
    this.totalCriticas = 0;
    this.porStatusCriticas = {};
    this.discrepanciasMontos  = [];
    this.montosNotInSat       = [];
    this.montosNotInErp       = [];
    this.montosSatCancelados  = [];
    this.montosPendientes     = [];
    this.totalMontos = 0;
    this.discrepanciasIva = [];
    this.totalIva = 0;
    this.satVigenteErpInactivo = [];
    this.pagosRelacionados = null;
    this.comparisonFacade.getDashboard(this.ejercicioSeleccionado, this.periodoSeleccionado, this.tipoSeleccionado, this.rfcEmisorSeleccionado).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.kpis = data.kpis;
        this.topDiscrepancyTypes = data.topDiscrepancyTypes;
        this.recentDiscrepancies = data.recentDiscrepancies;
        this.buildCharts(data.kpis);
        this.loading = false;
        this.toast.success('Dashboard actualizado');
        // Precargar totales de discrepancias críticas para mostrar conteo en la tarjeta
        this.comparisonFacade.getDiscrepanciasCriticas(this.ejercicioSeleccionado, this.periodoSeleccionado, this.tipoSeleccionado, this.rfcEmisorSeleccionado).subscribe({
          next: (res) => {
            this.discrepanciasCriticas   = res.items;
            this.criticasCancelados      = res.cancelados      ?? [];
            this.criticasDeshabilitados  = res.deshabilitados  ?? [];
            this.totalCriticas = res.total;
            this.porStatusCriticas = res.porStatus ?? {};
          },
          error: () => {},
        });
        // Documentos relacionados: solo para tipo P
        if (this.tipoSeleccionado === 'P') {
          this.loadingPagosRelacionados = true;
          this.comparisonFacade.getPagosRelacionados(this.ejercicioSeleccionado, this.periodoSeleccionado, this.rfcEmisorSeleccionado).subscribe({
            next: (res) => { this.pagosRelacionados = res; this.loadingPagosRelacionados = false; },
            error: () => { this.loadingPagosRelacionados = false; },
          });
        }
      },
      error: () => {
        this.error = 'Error cargando el dashboard';
        this.loading = false;
        this.toast.error('Error al cargar el dashboard');
      },
    });
  }

  private buildCharts(kpis: DashboardKPIs): void {
    const satStatusColor: Record<string, string> = {
      'Vigente':            '#22c55e',
      'Cancelado':          '#ef4444',
      'No Encontrado':      '#f59e0b',
      'Error':              '#94a3b8',
      'Deshabilitado':      '#9ca3af',
      'Expresión Inválida': '#6366f1',
      'Pendiente':          '#60a5fa',
      'Sin verificar':      '#e2e8f0',
    };
    this.satStatusChartData = {
      labels: kpis.cfdisBySatStatus.map(s => s._id || 'Sin verificar'),
      datasets: [{
        data: kpis.cfdisBySatStatus.map(s => s.count),
        backgroundColor: kpis.cfdisBySatStatus.map(s => satStatusColor[s._id || 'Sin verificar'] ?? '#e2e8f0'),
      }],
    };

    this.conciliationChartData = {
      labels: ['Conciliados', 'Con discrepancias / advertencias', 'Pendientes / sin comparar'],
      datasets: [{
        data: [kpis.conciliados, kpis.conDiscrepancia, kpis.sinConciliar],
        backgroundColor: ['#22c55e', '#ef4444', '#94a3b8'],
      }],
    };

    this.amountsChartData = {
      labels: ['Total SAT', 'Total Sistema (ERP)'],
      datasets: [{
        data: [kpis.totalSAT, kpis.totalERP],
        backgroundColor: ['#22c55e', '#3b82f6'],
        borderRadius: 4,
      }],
    };

  }

  get totalDiscrepanciasCriticas(): number {
    // Si ya cargamos el endpoint de críticas, usar ese total (más preciso)
    if (this.totalCriticas > 0) return this.totalCriticas;
    return this.kpis?.discrepancyStats.find(d => d._id === 'critical')?.count ?? 0;
  }

  get totalImpactoFiscal(): number {
    return this.kpis?.discrepancyStats.reduce((sum, d) => sum + (d.fiscalImpact ?? 0), 0) ?? 0;
  }

  get matchRate(): number {
    if (!this.kpis) return 0;
    const total = (this.kpis.conciliados ?? 0) + (this.kpis.conDiscrepancia ?? 0) + (this.kpis.sinConciliar ?? 0);
    return total > 0 ? Math.round(((this.kpis.conciliados ?? 0) / total) * 100) : 0;
  }

  get diferenciaAbs(): number {
    return Math.abs(this.kpis?.diferencia ?? 0);
  }

  get ivaTrasladadoTotal(): number { return this.kpis?.ivaStats?.ivaTrasladadoTotal ?? 0; }
  get ivaRetenidoTotal():   number { return this.kpis?.ivaStats?.ivaRetenidoTotal   ?? 0; }
  get ivaNeto():            number { return this.kpis?.ivaStats?.ivaNeto            ?? 0; }

  get ivaERP() { return this.kpis?.ivaStats?.erp ?? { ivaTrasladadoTotal: 0, ivaRetenidoTotal: 0, ivaNeto: 0 }; }
  get ivaSAT() { return this.kpis?.ivaStats?.sat ?? { ivaTrasladadoTotal: 0, ivaRetenidoTotal: 0, ivaNeto: 0 }; }
  get countERP():              number { return this.kpis?.countERP ?? 0; }
  get countSAT():              number { return this.kpis?.countSAT ?? 0; }
  get satCanceladosCount(): number { return this.kpis?.satCancelados?.count ?? 0; }
  get satCanceladosTotal(): number { return this.kpis?.satCancelados?.total ?? 0; }
  get noEncontradoCount(): number {
    return this.kpis?.cfdisBySatStatus.find(s => s._id === 'No Encontrado')?.count ?? 0;
  }

  // ── Pagos relacionados (solo cuando tipoSeleccionado === 'P') ────────────
  pagosRelacionados: PagosRelacionadosStats | null = null;
  loadingPagosRelacionados = false;

  // ── Reporte conciliación Excel ─────────────────────────────────────────────
  descargandoConciliacion = false;

  descargarConciliacionExcel(): void {
    this.descargandoConciliacion = true;
    this.comparisonFacade.getConciliacionExcel(this.ejercicioSeleccionado, this.periodoSeleccionado, this.rfcEmisorSeleccionado)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const ej = this.ejercicioSeleccionado ?? '';
          const pe = this.periodoSeleccionado
            ? ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][this.periodoSeleccionado - 1]
            : '';
          const label = pe ? `${pe}_${ej}` : ej ? `${ej}` : 'todos';
          const url = URL.createObjectURL(blob);
          const a   = document.createElement('a');
          a.href     = url;
          a.download = `conciliacion_${label}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
          this.descargandoConciliacion = false;
          this.toast.success('Reporte descargado');
        },
        error: () => {
          this.descargandoConciliacion = false;
          this.toast.error('Error al generar el reporte');
        },
      });
  }

  // ── CFDIs en SAT pero no en ERP ──────────────────────────────────────────
  notInErpItems:       any[]   = [];
  notInErpTotal:       number  = 0;
  duplicadosSAT:       any[]   = [];
  matchOtroPeriodo:    any[]   = [];
  loadingNotInErp:     boolean = false;
  modalNotInErpVisible         = false;

  get notInErpFueraPeriodo(): any[] {
    return this.notInErpItems.filter(c =>
      (this.ejercicioSeleccionado && c.ejercicio !== this.ejercicioSeleccionado) ||
      (this.periodoSeleccionado   && c.periodo   !== this.periodoSeleccionado)
    );
  }

  abrirModalNotInErp(): void {
    this.modalNotInErpVisible = true;
    if (this.notInErpItems.length === 0 && this.duplicadosSAT.length === 0) {
      this.loadingNotInErp = true;
      this.comparisonFacade.getNotInErp(this.ejercicioSeleccionado, this.periodoSeleccionado, this.tipoSeleccionado, this.rfcEmisorSeleccionado).subscribe({
        next: (res: any) => {
          this.notInErpItems    = res.sinContraparteErp ?? res.items ?? [];
          this.notInErpTotal    = res.totalSinContraparte ?? res.total ?? 0;
          this.duplicadosSAT    = res.duplicadosSAT ?? [];
          this.matchOtroPeriodo = res.matchOtroPeriodo ?? [];
          this.loadingNotInErp  = false;
        },
        error: () => { this.loadingNotInErp = false; },
      });
    }
  }

  cerrarModalNotInErp(): void { this.modalNotInErpVisible = false; }

  // ── Modal Discrepancias Críticas (todas) ─────────────────────────────────
  modalCriticasVisible      = false;
  discrepanciasCriticas:    DiscrepanciaMonto[] = [];
  loadingCriticas           = false;
  totalCriticas             = 0;
  porStatusCriticas: Record<string, number> = {};

  readonly STATUS_LABEL: Record<string, string> = {
    not_in_erp:  'En SAT, no en ERP',
    not_in_sat:  'En ERP, no en SAT',
    discrepancy: 'Discrepancia de campo',
    warning:     'Advertencia',
    cancelled:   'Cancelado en SAT',
  };
  readonly STATUS_COLOR: Record<string, string> = {
    not_in_erp:  '#b91c1c',
    not_in_sat:  '#b91c1c',
    discrepancy: '#b91c1c',
    cancelled:   '#7c3aed',
    warning:     '#d97706',
  };

  get criticasNotInErp():    DiscrepanciaMonto[] { return this.discrepanciasCriticas.filter(d => d.status === 'not_in_erp'); }
  get criticasNotInSat():    DiscrepanciaMonto[] { return this.discrepanciasCriticas.filter(d => d.status === 'not_in_sat'); }
  get criticasDiscrepancy(): DiscrepanciaMonto[] { return this.discrepanciasCriticas.filter(d => d.status === 'discrepancy' || d.status === 'warning'); }
  get criticasCancelled():   DiscrepanciaMonto[] { return this.discrepanciasCriticas.filter(d => d.status === 'cancelled'); }
  get criticasSatCancelado():DiscrepanciaMonto[] { return this.discrepanciasCriticas.filter(d => d.status === 'sat_cancelado'); }

  criticasCancelados:     DiscrepanciaMonto[] = [];
  criticasDeshabilitados: DiscrepanciaMonto[] = [];
  tabCriticas: 'vigentes' | 'cancelados' | 'deshabilitados' = 'vigentes';

  get criticasCanceladosPorTipo(): Record<string, DiscrepanciaMonto[]> {
    const g: Record<string, DiscrepanciaMonto[]> = {};
    for (const d of this.criticasCancelados) {
      const t = d.erpCfdiId?.tipoDeComprobante ?? (d as any).tipoDeComprobante ?? 'Sin tipo';
      if (!g[t]) g[t] = [];
      g[t].push(d);
    }
    return g;
  }
  get criticasCanceladosTipos(): string[] { return Object.keys(this.criticasCanceladosPorTipo).sort(); }

  get criticasDeshabilitadosPorTipo(): Record<string, DiscrepanciaMonto[]> {
    const g: Record<string, DiscrepanciaMonto[]> = {};
    for (const d of this.criticasDeshabilitados) {
      const t = d.erpCfdiId?.tipoDeComprobante ?? (d as any).tipoDeComprobante ?? 'Sin tipo';
      if (!g[t]) g[t] = [];
      g[t].push(d);
    }
    return g;
  }
  get criticasDeshabilitadosTipos(): string[] { return Object.keys(this.criticasDeshabilitadosPorTipo).sort(); }

  abrirModalCriticas(): void {
    this.modalCriticasVisible = true;
    this.tabCriticas = 'vigentes';
  }

  cerrarModalCriticas(): void { this.modalCriticasVisible = false; }

  // ── Modal Conciliación de Montos ──────────────────────────────────────────
  modalMontosVisible    = false;
  discrepanciasMontos:  DiscrepanciaMonto[] = [];
  montosNotInSat:       any[] = [];
  montosNotInErp:       any[] = [];
  montosSatCancelados:  any[] = [];
  montosPendientes:     any[] = [];
  loadingMontos         = false;
  totalMontos           = 0;

  readonly CAMPO_LABELS: Record<string, string> = {
    'total':                                    'Total',
    'subTotal':                                 'Subtotal',
    'impuestos.totalImpuestosTrasladados':       'IVA Trasladado',
    'impuestos.totalImpuestosRetenidos':         'IVA Retenido',
    'complementoPago.montoTotalPagos':          'Monto Total Pagos',
  };

  // ── CFDIs vigentes SAT pero inactivos en ERP ─────────────────────────────
  satVigenteErpInactivo: CfdiStatusMismatch[] = [];
  loadingSatVigente = false;

  get totalSatVigenteErpInactivo(): number {
    return this.satVigenteErpInactivo.reduce((s, c) => s + (c.total ?? 0), 0);
  }

  readonly ERP_STATUS_LABEL: Record<string, string> = {
    'Cancelado':           'Cancelado en ERP',
    'Deshabilitado':       'Deshabilitado en ERP',
    'Cancelacion Pendiente': 'Cancelación Pendiente',
  };

  readonly ERP_STATUS_COLOR: Record<string, string> = {
    'Cancelado':           '#b91c1c',
    'Deshabilitado':       '#6b7280',
    'Cancelacion Pendiente': '#d97706',
  };

  abrirModalMontos(): void {
    this.modalMontosVisible = true;
    if (this.discrepanciasMontos.length === 0 && this.montosNotInSat.length === 0) {
      this.loadingMontos = true;
      this.comparisonFacade.getDiscrepanciasMontos(this.ejercicioSeleccionado, this.periodoSeleccionado, this.tipoSeleccionado, undefined, this.rfcEmisorSeleccionado).subscribe({
        next: (res: any) => {
          this.discrepanciasMontos  = res.items;
          this.totalMontos          = res.total;
          this.montosNotInSat       = res.notInSat     ?? [];
          this.montosNotInErp       = res.notInErp     ?? [];
          this.montosSatCancelados  = res.satCancelados ?? [];
          this.montosPendientes     = res.pendientes   ?? [];
          this.loadingMontos = false;
        },
        error: () => { this.loadingMontos = false; },
      });
    }
    if (this.satVigenteErpInactivo.length === 0) {
      this.loadingSatVigente = true;
      this.comparisonFacade.getSatVigenteErpInactivo(this.ejercicioSeleccionado, this.periodoSeleccionado, this.tipoSeleccionado, this.rfcEmisorSeleccionado).subscribe({
        next: (res) => { this.satVigenteErpInactivo = res.items; this.loadingSatVigente = false; },
        error: () => { this.loadingSatVigente = false; },
      });
    }
  }

  cerrarModalMontos(): void {
    this.modalMontosVisible   = false;
    this.discrepanciasMontos  = [];
    this.montosNotInSat       = [];
    this.montosNotInErp       = [];
    this.montosSatCancelados  = [];
    this.montosPendientes     = [];
    this.totalMontos          = 0;
  }

  get montosCriticos(): DiscrepanciaMonto[] {
    return this.discrepanciasMontos.filter(d =>
      d.differences.some(diff => diff.severity === 'critical')
    );
  }
  get montosAdvertencia(): DiscrepanciaMonto[] {
    return this.discrepanciasMontos.filter(d =>
      !d.differences.some(diff => diff.severity === 'critical') &&
      d.differences.some(diff => diff.severity === 'warning')
    );
  }

  // ── Modal IVA detalle ─────────────────────────────────────────────────────
  modalIvaVisible      = false;
  discrepanciasIva:    DiscrepanciaMonto[] = [];
  loadingIva           = false;
  totalIva             = 0;
  readonly CAMPOS_IVA  = 'impuestos.totalImpuestosTrasladados,impuestos.totalImpuestosRetenidos';
  readonly TIPO_LABELS: Record<string, string> = {
    I: 'Ingreso', E: 'Egreso', P: 'Pago', T: 'Traslado', N: 'Nómina',
  };

  get ivaByTipoEntries(): Array<{ tipo: string; label: string; erp: any; sat: any; difTrasladado: number; difRetenido: number; difNeto: number }> {
    const byTipo = this.kpis?.ivaStats?.byTipo ?? {};
    return Object.entries(byTipo).map(([tipo, v]) => ({
      tipo,
      label: this.TIPO_LABELS[tipo] ?? tipo,
      erp: v.erp ?? { ivaTrasladadoTotal: 0, ivaRetenidoTotal: 0, ivaNeto: 0, count: 0 },
      sat: v.sat ?? { ivaTrasladadoTotal: 0, ivaRetenidoTotal: 0, ivaNeto: 0, count: 0 },
      difTrasladado: (v.erp?.ivaTrasladadoTotal ?? 0) - (v.sat?.ivaTrasladadoTotal ?? 0),
      difRetenido:   (v.erp?.ivaRetenidoTotal   ?? 0) - (v.sat?.ivaRetenidoTotal   ?? 0),
      difNeto:       (v.erp?.ivaNeto            ?? 0) - (v.sat?.ivaNeto            ?? 0),
    })).sort((a, b) => Math.abs(b.difNeto) - Math.abs(a.difNeto));
  }

  getDiff(diffs: any[], field: string): any {
    return diffs?.find(d => d.field === field) ?? null;
  }

  getDiferenciaTotal(item: DiscrepanciaMonto): number {
    // Usa el campo 'total' de differences si existe, si no suma todos los fiscalImpact
    const totalDiff = item.differences?.find(d => d.field === 'total');
    if (totalDiff) {
      return (totalDiff.erpValue as number ?? 0) - (totalDiff.satValue as number ?? 0);
    }
    return item.differences?.reduce((sum, d) => sum + ((d.fiscalImpact as any)?.amount ?? 0), 0) ?? 0;
  }

  abrirModalIva(): void {
    this.modalIvaVisible = true;
    if (this.discrepanciasIva.length === 0) {
      this.loadingIva = true;
      this.comparisonFacade.getDiscrepanciasMontos(this.ejercicioSeleccionado, this.periodoSeleccionado, this.tipoSeleccionado, this.CAMPOS_IVA, this.rfcEmisorSeleccionado).subscribe({
        next: (res) => { this.discrepanciasIva = res.items; this.totalIva = res.total; this.loadingIva = false; },
        error: () => { this.loadingIva = false; },
      });
    }
  }
  cerrarModalIva(): void { this.modalIvaVisible = false; }

  get ivaCriticos(): DiscrepanciaMonto[] {
    return this.discrepanciasIva.filter(d =>
      d.differences.some(diff => diff.severity === 'critical')
    );
  }
  get ivaAdvertencia(): DiscrepanciaMonto[] {
    return this.discrepanciasIva.filter(d =>
      !d.differences.some(diff => diff.severity === 'critical') &&
      d.differences.some(diff => diff.severity === 'warning')
    );
  }

  getDiferenciaIva(item: DiscrepanciaMonto): number {
    return (item.differences ?? []).reduce((sum, d) => {
      return sum + ((d.erpValue as number ?? 0) - (d.satValue as number ?? 0));
    }, 0);
  }

  onEjercicioChange(): void {
    this.periodoSeleccionado = undefined;
    this.periodoActivoService.set(this.ejercicioSeleccionado ?? null, null);
    this.loadDashboard();
  }

  onPeriodoChange(): void {
    this.periodoActivoService.set(this.ejercicioSeleccionado ?? null, this.periodoSeleccionado ?? null);
    this.loadDashboard();
  }

  onTipoChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.tipoSeleccionado = val || undefined;
    this.loadDashboard();
  }

  runBatchComparison(): void {
    this.comparacionEnCurso = true;
    this.comparisonFacade.runBatch(
      {},
      this.ejercicioSeleccionado,
      this.periodoSeleccionado,
      this.tipoSeleccionado,
    ).subscribe({
      next: (res) => {
        this.toast.success('Comparación iniciada — el dashboard se actualizará al terminar');
        if (res?.sessionId) this.iniciarPollingComparacion(res.sessionId);
      },
      error: () => {
        this.comparacionEnCurso = false;
        this.toast.error('Error al iniciar la comparación');
      },
    });
  }

  private iniciarPollingComparacion(sessionId: string): void {
    this.pollingSub?.unsubscribe();
    this.pollingSub = interval(5000).pipe(
      switchMap(() => this.comparisonFacade.getSessionStatus(sessionId)),
      takeWhile(res => res.session?.status === 'running', true),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (res) => {
        if (res.session?.status !== 'running') {
          this.comparacionEnCurso = false;
          this.pollingSub = null;
          if (res.session?.status === 'completed') {
            this.toast.success('Comparación completada');
            this.loadDashboard();
          } else {
            this.toast.error('La comparación terminó con errores');
            this.loadDashboard();
          }
        }
      },
      error: () => {
        this.comparacionEnCurso = false;
        this.pollingSub = null;
      },
    });
  }
}
