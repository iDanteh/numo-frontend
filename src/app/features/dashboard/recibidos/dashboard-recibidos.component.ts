import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { ComparisonFacade } from '../../../core/facades';
import { DashboardRecibidosKPIs } from '../../../core/models/cfdi.model';
import { MESES_LABELS } from '../../../core/constants/cfdi-labels';
import { ToastService } from '../../../core/services/toast.service';
import { EntidadActivaService } from '../../../core/services/entidad-activa.service';

@Component({
  standalone: false,
  selector: 'app-dashboard-recibidos',
  templateUrl: './dashboard-recibidos.component.html',
})
export class DashboardRecibidosComponent implements OnInit, OnDestroy {
  @Output() volver = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  kpis: DashboardRecibidosKPIs | null = null;
  loading = true;
  error: string | null = null;

  ejercicioSeleccionado?: number;
  periodoSeleccionado?: number;
  tipoSeleccionado?: string;
  rfcReceptorSeleccionado?: string;
  readonly ejercicios = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
  readonly meses = MESES_LABELS.map((nombre, i) => ({ valor: i + 1, nombre }));
  readonly tipos = [
    { valor: 'I', label: 'I - Ingreso' },
    { valor: 'E', label: 'E - Egreso' },
    { valor: 'P', label: 'P - Pago' },
    { valor: 'N', label: 'N - Nómina' },
  ];

  readonly TIPO_LABELS: Record<string, string> = { I: 'Ingreso', E: 'Egreso', P: 'Pago', T: 'Traslado', N: 'Nómina' };

  readonly donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const, labels: { font: { size: 11 }, boxWidth: 10, padding: 8 } },
    },
  };

  satStatusChartData: any = { datasets: [], labels: [] };

  private readonly SAT_STATUS_COLOR: Record<string, string> = {
    'Vigente':            '#22c55e',
    'Cancelado':          '#ef4444',
    'No Encontrado':      '#f59e0b',
    'Error':              '#94a3b8',
    'Expresión Inválida': '#6366f1',
    'Pendiente':          '#60a5fa',
    'Sin verificar':      '#e2e8f0',
  };

  constructor(
    private comparisonFacade: ComparisonFacade,
    private toast: ToastService,
    private entidadActivaService: EntidadActivaService,
  ) {}

  ngOnInit(): void {
    this.entidadActivaService.entidadActiva$.pipe(takeUntil(this.destroy$)).subscribe(entidad => {
      this.rfcReceptorSeleccionado = entidad?.rfc ?? undefined;
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading = true;
    this.comparisonFacade.getDashboardRecibidos(this.ejercicioSeleccionado, this.periodoSeleccionado, this.tipoSeleccionado, this.rfcReceptorSeleccionado)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.kpis = data.kpis;
          this.buildChart(data.kpis);
          this.loading = false;
        },
        error: () => {
          this.error = 'Error cargando el dashboard de Recibidos';
          this.loading = false;
          this.toast.error('Error al cargar el dashboard de Recibidos');
        },
      });
  }

  private buildChart(kpis: DashboardRecibidosKPIs): void {
    this.satStatusChartData = {
      labels: kpis.cfdisBySatStatus.map(s => s._id || 'Sin verificar'),
      datasets: [{
        data: kpis.cfdisBySatStatus.map(s => s.count),
        backgroundColor: kpis.cfdisBySatStatus.map(s => this.SAT_STATUS_COLOR[s._id || 'Sin verificar'] ?? '#e2e8f0'),
      }],
    };
  }

  onEjercicioChange(): void { this.periodoSeleccionado = undefined; this.load(); }
  onPeriodoChange(): void { this.load(); }
  onTipoChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.tipoSeleccionado = val || undefined;
    this.load();
  }

  private statusCount(id: string): number {
    return this.kpis?.cfdisBySatStatus.find(s => s._id === id)?.count ?? 0;
  }

  get vigenteCount(): number { return this.statusCount('Vigente'); }
  get canceladoCount(): number { return this.statusCount('Cancelado'); }
  get noEncontradoCount(): number { return this.statusCount('No Encontrado'); }
}
