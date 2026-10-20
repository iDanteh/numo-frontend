import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PolizaAuditoriaService } from '../../core/services/poliza-auditoria.service';
import {
  AccionPoliza, ActividadDia, CancelacionAuditoria, FiltrosAuditoria, RegistroAuditoria, ResumenUsuario,
} from '../../core/models/poliza-auditoria.model';

type Pestana = 'resumen' | 'cancelaciones' | 'bitacora';

const ETIQUETA_ACCION: Record<AccionPoliza, string> = {
  creada:             'Creada',
  editada:            'Editada',
  contabilizada:      'Contabilizada',
  cancelada:          'Cancelada',
  revertida:          'Revertida',
  exportada:          'Exportada',
  exportada_xml_sat:  'XML SAT',
  folio_contpaq:      'Folio CONTPAQ',
  cuenta_reemplazada: 'Cuenta reemplazada',
};

// Colores por acción (gráfica + badges) — mismos tonos en ambos lados.
const COLOR_ACCION: Record<AccionPoliza, string> = {
  creada:             '#2563eb',
  editada:            '#7c3aed',
  contabilizada:      '#0e9c6f',
  cancelada:          '#c22525',
  revertida:          '#b5790a',
  exportada:          '#0891b2',
  exportada_xml_sat:  '#0f766e',
  folio_contpaq:      '#64748b',
  cuenta_reemplazada: '#a21caf',
};

const TIPOS_POLIZA: { value: string; label: string }[] = [
  { value: '',    label: 'Todos los tipos' },
  { value: 'I',   label: 'Ingreso' },
  { value: 'E',   label: 'Egreso' },
  { value: 'COB', label: 'Cobranza' },
  { value: 'D',   label: 'Diario (incl. Cobranza / Cierre IVA)' },
  { value: 'T',   label: 'Traspasos C.P.' },
  { value: 'B',   label: 'Compensaciones Bancarias' },
  { value: 'G',   label: 'Intereses Ganados' },
];

const PESTANA_KEY = 'numo_poliza_auditoria_pestana';

/** 'YYYY-MM-DD' de hoy en hora de México. */
function hoyMx(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
}

@Component({
  standalone: false,
  selector: 'app-poliza-auditoria',
  templateUrl: './poliza-auditoria.component.html',
  styleUrls: ['./poliza-auditoria.component.css'],
})
export class PolizaAuditoriaComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  readonly tipos = TIPOS_POLIZA;
  readonly columnasAccion: AccionPoliza[] = [
    'creada', 'editada', 'contabilizada', 'cancelada', 'revertida', 'exportada', 'folio_contpaq',
  ];
  acciones: AccionPoliza[] = Object.keys(ETIQUETA_ACCION) as AccionPoliza[];
  usuarios: string[] = [];

  pestana: Pestana = this.leerPestana();

  // Filtros generales (aplican a las 3 pestañas)
  desde = hoyMx().slice(0, 8) + '01';
  hasta = hoyMx();
  usuario = '';
  tipo = '';

  // Resumen
  resumen: ResumenUsuario[] = [];
  resumenLoading = false;
  resumenError = false;
  kpis = { total: 0, creadas: 0, contabilizadas: 0, canceladas: 0, revertidas: 0, exportadas: 0, usuarios: 0 };
  chartActividad: any = { labels: [], datasets: [] };
  chartCancelaciones: any = { labels: [], datasets: [] };

  readonly opcionesActividad = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    scales: {
      x: { stacked: true, ticks: { maxTicksLimit: 16, font: { size: 10 } }, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
    },
    plugins: { legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 10, font: { size: 11 } } } },
  };

  readonly opcionesCancelaciones = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    scales: {
      x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
      y: { ticks: { font: { size: 11 } }, grid: { display: false } },
    },
    plugins: { legend: { display: false } },
  };

  // Cancelaciones
  cancelaciones: CancelacionAuditoria[] | null = null;
  cancelacionesLoading = false;
  cancelacionesError = false;

  // Bitácora
  accion = '';
  busqueda = '';
  pagina = 1;
  readonly porPagina = 50;
  bitacora: RegistroAuditoria[] = [];
  bitacoraTotal = 0;
  bitacoraCargada = false;
  bitacoraLoading = false;
  bitacoraError = false;
  expandido: number | null = null;

  constructor(private service: PolizaAuditoriaService) {}

  ngOnInit(): void {
    this.service.catalogos().pipe(takeUntil(this.destroy$)).subscribe({
      next: (c) => { this.usuarios = c.usuarios; },
      error: () => { /* el filtro de usuario queda vacío; el resto funciona */ },
    });
    this.recargar();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Filtros / pestañas ──────────────────────────────────────────────────────

  private filtros(): FiltrosAuditoria {
    return { desde: this.desde, hasta: this.hasta, usuario: this.usuario, tipo: this.tipo };
  }

  onRango(r: { fechaInicio: string; fechaFin: string }): void {
    this.desde = r.fechaInicio;
    this.hasta = r.fechaFin;
    this.recargar();
  }

  /** Recarga la pestaña visible; las otras se piden al abrirlas. */
  recargar(): void {
    this.cancelaciones = null;
    this.bitacoraCargada = false;
    this.pagina = 1;
    this.cargarPestana();
  }

  cambiarPestana(p: Pestana): void {
    this.pestana = p;
    try { localStorage.setItem(PESTANA_KEY, p); } catch { /* sin persistencia */ }
    this.cargarPestana();
  }

  private cargarPestana(): void {
    if (this.pestana === 'resumen') this.cargarResumen();
    else if (this.pestana === 'cancelaciones' && this.cancelaciones === null) this.cargarCancelaciones();
    else if (this.pestana === 'bitacora' && !this.bitacoraCargada) this.cargarBitacora();
  }

  private leerPestana(): Pestana {
    try {
      const p = localStorage.getItem(PESTANA_KEY);
      if (p === 'resumen' || p === 'cancelaciones' || p === 'bitacora') return p;
    } catch { /* default */ }
    return 'resumen';
  }

  /** Clic en un usuario del resumen → filtra todo por ese usuario. */
  filtrarUsuario(u: string): void {
    this.usuario = this.usuario === u ? '' : u;
    this.recargar();
  }

  limpiarFiltros(): void {
    this.desde = hoyMx().slice(0, 8) + '01';
    this.hasta = hoyMx();
    this.usuario = '';
    this.tipo = '';
    this.accion = '';
    this.busqueda = '';
    this.recargar();
  }

  // ── Reporte (.xlsx con todo el monitor) ─────────────────────────────────────

  descargandoReporte = false;

  /** Descarga un .xlsx con todo (resumen, actividad, bitácora, cancelaciones,
   *  exportaciones) respetando los filtros activos, incluidos acción y búsqueda. */
  descargarReporte(): void {
    if (this.descargandoReporte) return;
    this.descargandoReporte = true;
    const f: FiltrosAuditoria = { ...this.filtros(), accion: this.accion, q: this.busqueda.trim() };
    this.service.reporteXlsx(f).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Monitor_Polizas_${hoyMx()}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.descargandoReporte = false;
      },
      error: () => { this.descargandoReporte = false; },
    });
  }

  // ── Resumen ─────────────────────────────────────────────────────────────────

  cargarResumen(): void {
    this.resumenLoading = true;
    this.resumenError = false;
    const f = this.filtros();
    forkJoin({ resumen: this.service.resumen(f), dias: this.service.actividadDiaria(f) })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ resumen, dias }) => {
          // El resumen ignora el filtro de usuario en el backend (para comparar entre
          // usuarios); aquí se respeta si hay uno elegido.
          this.resumen = this.usuario ? resumen.filter(r => r.usuario === this.usuario) : resumen;
          this.calcularKpis();
          this.armarGraficaActividad(dias);
          this.armarGraficaCancelaciones();
          this.resumenLoading = false;
        },
        error: () => {
          this.resumenLoading = false;
          this.resumenError = true;
        },
      });
  }

  private calcularKpis(): void {
    const suma = (a: AccionPoliza) => this.resumen.reduce((s, r) => s + (r.acciones[a] ?? 0), 0);
    this.kpis = {
      total:          this.resumen.reduce((s, r) => s + r.total, 0),
      creadas:        suma('creada'),
      contabilizadas: suma('contabilizada'),
      canceladas:     suma('cancelada'),
      revertidas:     suma('revertida'),
      exportadas:     suma('exportada') + suma('exportada_xml_sat'),
      usuarios:       this.resumen.filter(r => r.usuario !== '(sin registro)' && r.usuario !== 'sistema').length,
    };
  }

  private armarGraficaActividad(dias: ActividadDia[]): void {
    const labels = this.diasDelRango();
    const indice = new Map(labels.map((d, i) => [d, i]));
    const graficadas: AccionPoliza[] = ['creada', 'contabilizada', 'cancelada', 'revertida', 'exportada', 'editada'];
    const datasets = graficadas.map(a => {
      const data = new Array(labels.length).fill(0);
      for (const d of dias) {
        const i = indice.get(d.dia);
        if (d.accion === a && i !== undefined) data[i] += d.total;
      }
      return { label: ETIQUETA_ACCION[a], data, backgroundColor: COLOR_ACCION[a], borderWidth: 0, maxBarThickness: 28 };
    }).filter(ds => ds.data.some((v: number) => v > 0));
    this.chartActividad = { labels: labels.map(d => `${d.slice(8, 10)}/${d.slice(5, 7)}`), datasets };
  }

  private armarGraficaCancelaciones(): void {
    const filas = this.resumen
      .filter(r => (r.acciones.cancelada ?? 0) > 0)
      .sort((a, b) => (b.acciones.cancelada ?? 0) - (a.acciones.cancelada ?? 0))
      .slice(0, 12);
    this.chartCancelaciones = {
      labels: filas.map(r => r.usuario),
      datasets: [{
        label: 'Cancelaciones',
        data: filas.map(r => r.acciones.cancelada ?? 0),
        backgroundColor: COLOR_ACCION.cancelada,
        borderWidth: 0,
        maxBarThickness: 22,
      }],
    };
  }

  /** Todos los días del rango (para que la gráfica no salte días sin actividad). */
  private diasDelRango(): string[] {
    const out: string[] = [];
    if (!this.desde || !this.hasta) return out;
    const d = new Date(`${this.desde}T12:00:00Z`);
    const fin = new Date(`${this.hasta}T12:00:00Z`);
    while (d <= fin && out.length < 400) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }

  get alturaCancelaciones(): number {
    return Math.max(140, (this.chartCancelaciones.labels?.length ?? 0) * 30 + 40);
  }

  // ── Cancelaciones ───────────────────────────────────────────────────────────

  cargarCancelaciones(): void {
    this.cancelacionesLoading = true;
    this.cancelacionesError = false;
    this.service.cancelaciones(this.filtros()).pipe(takeUntil(this.destroy$)).subscribe({
      next: (rows) => {
        this.cancelaciones = rows;
        this.cancelacionesLoading = false;
      },
      error: () => {
        this.cancelaciones = [];
        this.cancelacionesLoading = false;
        this.cancelacionesError = true;
      },
    });
  }

  get cancelacionesRegeneradas(): number {
    return (this.cancelaciones ?? []).filter(c => c.regeneradaId).length;
  }

  get cancelacionesContabilizadas(): number {
    return (this.cancelaciones ?? []).filter(c => c.estadoAnterior === 'contabilizada').length;
  }

  // ── Bitácora ────────────────────────────────────────────────────────────────

  buscarBitacora(): void {
    this.pagina = 1;
    this.cargarBitacora();
  }

  cargarBitacora(): void {
    this.bitacoraLoading = true;
    this.bitacoraError = false;
    this.service.bitacora({
      ...this.filtros(), accion: this.accion, q: this.busqueda.trim(), page: this.pagina, limit: this.porPagina,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.bitacora = p.rows;
        this.bitacoraTotal = p.total;
        this.bitacoraCargada = true;
        this.bitacoraLoading = false;
      },
      error: () => {
        this.bitacoraLoading = false;
        this.bitacoraError = true;
      },
    });
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.bitacoraTotal / this.porPagina));
  }

  irPagina(p: number): void {
    if (p < 1 || p > this.totalPaginas || p === this.pagina) return;
    this.pagina = p;
    this.cargarBitacora();
  }

  toggleDetalle(id: number): void {
    this.expandido = this.expandido === id ? null : id;
  }

  // ── Helpers de vista ────────────────────────────────────────────────────────

  etiquetaAccion(a: string): string {
    return ETIQUETA_ACCION[a as AccionPoliza] ?? a;
  }

  colorAccion(a: string): string {
    return COLOR_ACCION[a as AccionPoliza] ?? '#64748b';
  }

  etiquetaTipo(tipo: string | null, concepto: string | null): string {
    if (!tipo) return '—';
    if (tipo === 'D' && /^Ingresos por Cobranza/.test(concepto ?? '')) return 'Cobranza';
    if (tipo === 'D' && /Cierre IVA/.test(concepto ?? '')) return 'Cierre IVA';
    const t: Record<string, string> = {
      I: 'Ingreso', E: 'Egreso', D: 'Diario', T: 'Traspasos', B: 'Compensaciones', G: 'Intereses', N: 'Nómina', A: 'Apertura', C: 'Cheque', P: 'Pago',
    };
    return t[tipo] ?? tipo;
  }

  folio(tipo: string | null, numero: number | null): string {
    return tipo && numero != null ? `${tipo}-${numero}` : '—';
  }

  fechaHora(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  fechaCorta(ymd: string | null): string {
    return ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '—';
  }

  detalleTexto(r: RegistroAuditoria): string {
    if (!r.detalle) return '';
    return Object.entries(r.detalle)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join(' · ');
  }

  trackId(_: number, r: { id: number }): number {
    return r.id;
  }

  trackUsuario(_: number, r: ResumenUsuario): string {
    return r.usuario;
  }
}
