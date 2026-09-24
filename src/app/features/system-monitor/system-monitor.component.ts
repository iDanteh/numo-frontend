import { Component, OnDestroy, OnInit } from '@angular/core';
import { EMPTY, Subject, interval } from 'rxjs';
import { catchError, startWith, switchMap, takeUntil } from 'rxjs/operators';
import { SystemMonitorService } from '../../core/services/system-monitor.service';
import { EstadoSistema, HistorialPunto, SystemMonitorSnapshot } from '../../core/models/system-monitor.model';

// Polling en vez de push (SSE/WebSocket) — ver la nota de arquitectura en
// numo-backend/src/system-monitor/system-monitor.routes.js: el JWT de Auth0 solo se
// inyecta en llamadas de HttpClient (AuthHttpInterceptor), nunca en EventSource. 5s
// es lo bastante frecuente para "¿está cayendo ahora mismo?" sin generar carga
// perceptible (1 request liviana cada 5s, mismo orden de magnitud que cualquier
// polling ya usado en el resto de la app).
const INTERVALO_POLL_MS = 5000;

@Component({
  standalone: false,
  selector: 'app-system-monitor',
  templateUrl: './system-monitor.component.html',
  styleUrls: ['./system-monitor.component.css'],
})
export class SystemMonitorComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  snapshot: SystemMonitorSnapshot | null = null;
  loading = true;
  error = false;

  readonly chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    scales: {
      x: { ticks: { maxTicksLimit: 12, font: { size: 10 } }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { font: { size: 10 } } },
    },
    plugins: { legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 10, font: { size: 11 } } } },
  };

  chartData: any = { labels: [], datasets: [] };

  // ── Histórico persistente (mejora #3) — mismo patrón de bloque colapsable con
  // localStorage que "Distribución por franja de tiempo" en bank-indicadores-panel.
  // Colapsado por default: a diferencia del panel en vivo (la razón de ser de esta
  // pantalla), el histórico es una consulta puntual, no algo que se mira siempre.
  private static readonly HISTORIAL_COLLAPSED_KEY = 'numo_system_monitor_historial_collapsed';
  historialCollapsed = this.readHistorialCollapsed();
  historialData: HistorialPunto[] | null = null;
  historialLoading = false;
  historialError = false;
  fechaInicioHistorial = '';
  fechaFinHistorial = '';
  historialChartData: any = { labels: [], datasets: [] };

  constructor(private service: SystemMonitorService) {}

  ngOnInit(): void {
    interval(INTERVALO_POLL_MS)
      .pipe(
        startWith(0),
        // El catchError va DENTRO del switchMap (envolviendo la petición interna),
        // no en el subscribe de afuera: un error ahí PROPAGA y completa toda la
        // suscripción — el interval externo dejaría de emitir PARA SIEMPRE, justo
        // cuando el backend con problemas es lo que este panel existe para mostrar.
        // Atrapándolo acá, el tick que falló se resuelve a EMPTY (no emite nada) y
        // el interval de afuera sigue vivo, reintentando en el próximo tick.
        switchMap(() => this.service.snapshot().pipe(
          catchError(() => {
            this.error = true;
            this.loading = false;
            return EMPTY;
          }),
        )),
        takeUntil(this.destroy$),
      )
      .subscribe((snap) => {
        this.snapshot = snap;
        this.error = false;
        this.loading = false;
        this.buildChart(snap);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Histórico persistente ────────────────────────────────────────────────
  toggleHistorial(): void {
    this.historialCollapsed = !this.historialCollapsed;
    try {
      localStorage.setItem(SystemMonitorComponent.HISTORIAL_COLLAPSED_KEY, String(this.historialCollapsed));
    } catch {
      // localStorage puede fallar en modo privado/cuota llena — la preferencia simplemente no persiste.
    }
    // Fetch perezoso (mismo criterio que el resto del proyecto): recién se pide
    // al expandir por primera vez, no en ngOnInit — es una consulta puntual, no
    // parte del refresco en vivo de arriba.
    if (!this.historialCollapsed && this.historialData === null) this.cargarHistorial();
  }

  onRangoHistorialChange(rango: { fechaInicio: string; fechaFin: string }): void {
    this.fechaInicioHistorial = rango.fechaInicio;
    this.fechaFinHistorial = rango.fechaFin;
    this.cargarHistorial();
  }

  cargarHistorial(): void {
    this.historialLoading = true;
    this.historialError = false;
    this.service.historial(this.fechaInicioHistorial || undefined, this.fechaFinHistorial || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (puntos) => {
          this.historialLoading = false;
          this.historialData = puntos;
          this.buildHistorialChart(puntos);
        },
        error: () => {
          this.historialLoading = false;
          this.historialError = true;
        },
      });
  }

  private buildHistorialChart(puntos: HistorialPunto[]): void {
    this.historialChartData = {
      labels: puntos.map(p => this.formatFechaHistorial(p.fecha)),
      datasets: [
        {
          label: 'Requests/min',
          data: puntos.map(p => p.requestsPorMinuto),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,.12)',
          fill: true,
          tension: .25,
          pointRadius: 0,
        },
        {
          label: 'Errores (último minuto de cada punto)',
          data: puntos.map(p => p.erroresUltimoMinuto),
          borderColor: '#c22525',
          backgroundColor: 'rgba(194,37,37,.12)',
          fill: true,
          tension: .25,
          pointRadius: 0,
        },
      ],
    };
  }

  formatFechaHistorial(iso: string): string {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm} ${this.formatHora(d.getTime())}`;
  }

  private readHistorialCollapsed(): boolean {
    try {
      const v = localStorage.getItem(SystemMonitorComponent.HISTORIAL_COLLAPSED_KEY);
      return v === null ? true : v === 'true';
    } catch {
      return true;
    }
  }

  private buildChart(snap: SystemMonitorSnapshot): void {
    this.chartData = {
      labels: snap.serieUltimaHora.map(p => this.formatHora(p.ts)),
      datasets: [
        {
          label: 'Requests/min',
          data: snap.serieUltimaHora.map(p => p.total),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,.12)',
          fill: true,
          tension: .25,
          pointRadius: 0,
        },
        {
          label: 'Errores 5xx',
          data: snap.serieUltimaHora.map(p => p.errores),
          borderColor: '#c22525',
          backgroundColor: 'rgba(194,37,37,.12)',
          fill: true,
          tension: .25,
          pointRadius: 0,
        },
      ],
    };
  }

  formatHora(tsMs: number): string {
    const d = new Date(tsMs);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  formatHoraIso(iso: string): string {
    return this.formatHora(new Date(iso).getTime());
  }

  formatUptime(segundos: number): string {
    const dias = Math.floor(segundos / 86400);
    const horas = Math.floor((segundos % 86400) / 3600);
    const minutos = Math.floor((segundos % 3600) / 60);
    if (dias > 0) return `${dias}d ${horas}h`;
    if (horas > 0) return `${horas}h ${minutos}m`;
    return `${minutos}m`;
  }

  bannerTexto(estado: EstadoSistema): string {
    if (estado === 'caido') return 'El sistema dejó de recibir tráfico o perdió la conexión a la base de datos — revisa de inmediato.';
    if (estado === 'degradado') return 'El sistema está funcionando, pero con señales de degradación (errores, latencia o una base de datos con problemas).';
    return '';
  }

  toneEstado(estado: EstadoSistema): 'good' | 'warn' | 'critical' {
    if (estado === 'caido') return 'critical';
    if (estado === 'degradado') return 'warn';
    return 'good';
  }

  // El corte "critical" (10) DEBE coincidir con UMBRAL_TASA_ERROR_DEGRADADO (0.10)
  // en numo-backend/src/system-monitor/system-monitor.service.js — no hay forma de
  // compartir la constante entre Angular y Node, así que un cambio ahí requiere
  // actualizar este número a mano.
  toneTasaError(pct: number): 'good' | 'warn' | 'critical' {
    if (pct > 10) return 'critical';
    if (pct > 2) return 'warn';
    return 'good';
  }

  // El corte "critical" (200) DEBE coincidir con UMBRAL_LAG_DEGRADADO_MS en
  // numo-backend/src/system-monitor/system-monitor.service.js — mismo criterio
  // que toneTasaError() de arriba.
  toneLag(ms: number): 'good' | 'warn' | 'critical' {
    if (ms > 200) return 'critical';
    if (ms > 80) return 'warn';
    return 'good';
  }

  toneConexion(estado: 'conectado' | 'desconectado'): 'good' | 'critical' {
    return estado === 'conectado' ? 'good' : 'critical';
  }

  // El corte "critical" (load1 > cores) DEBE coincidir con la condición de CPU en
  // calcularEstadoGeneral() (system-monitor.service.js) — mismo criterio de
  // sincronización manual que toneTasaError()/toneLag() de arriba. cores<=0
  // (Windows en dev) nunca da "critical" por diseño.
  toneCpu(load1: number, cores: number): 'good' | 'warn' | 'critical' {
    if (cores <= 0) return 'good';
    if (load1 > cores) return 'critical';
    if (load1 > cores * 0.7) return 'warn';
    return 'good';
  }

  toneMemHost(usadoPct: number): 'good' | 'warn' | 'critical' {
    if (usadoPct > 90) return 'critical';
    if (usadoPct > 75) return 'warn';
    return 'good';
  }
}
