import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import { catchError, map, switchMap, takeUntil } from 'rxjs/operators';
import { Chart } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { BankService } from '../../../../core/services/bank.service';
import {
  BankCorteConciliacion, BankLedgerDiaItem, BankLedgerDiario, BankLedgerMensual, BankLedgerMesItem,
  BankLedgerHoraItem, BankLedgerPorHora, BankUltimosMovimientos, BankUltimoMovimientoItem,
} from '../../../../core/models/bank.model';
import { ToastService } from '../../../../core/services/toast.service';
import { SocketService } from '../../../../core/services/socket.service';

// Registrado una sola vez a nivel módulo — `provideCharts(withDefaultRegisterables())` en
// banks.module.ts registra los controladores base de Chart.js, pero datalabels es un plugin
// aparte que no viene incluido ahí. Por default dibuja el valor crudo en cada punto — cada chart
// de este componente lo desactiva explícitamente (`plugins.datalabels.display:false` o
// `datalabels:{display:false}` por dataset) salvo que necesite una etiqueta puntual.
Chart.register(ChartDataLabels);

export type CortePeriodo = 'semanal' | 'mensual';

/**
 * Slide del dashboard de Bancos — "corte" de conciliación (2026-10-02, pedido explícito
 * del usuario): control periódico de EQUIPO para que cobranza (semanal) y contabilidad
 * (mensual) sepan, del periodo en curso (lunes / día 1 del mes → ahora), cuántos depósitos
 * siguen rezagados de ANTES del periodo, cuántos nuevos llegaron y en qué estatus están, y
 * cuántos se identificaron — separado por si eran rezago viejo o del lote nuevo, para no
 * mezclarlos en un solo número.
 *
 * Periodo por rol (decisión de UX, mismo criterio que la visibilidad de slides del carousel
 * — ver bank-dashboard-carousel.component.ts): cobranza/contabilidad quedan fijos al periodo
 * configurado para su rol, cualquier otro rol (admin, etc.) puede alternar entre ambos. Desde
 * 2026-10-05 esta decisión la resuelve el BACKEND (GET /banks/cortes/periodo-rol, ver
 * bank-indicadores.service.js#getPeriodoCortePorRol — configurable desde Configuraciones
 * Globales), ya no `AuthService.hasRole()` acá: el backend conoce el rol autenticado y es
 * el único lado con permiso para leer Configuraciones Globales.
 *
 * Sin navegación a periodos pasados (confirmado con el usuario, AskUserQuestion) — siempre
 * el periodo EN CURSO, recargable con el resto del dashboard (banco/fetch perezoso por el
 * carousel padre), mismo patrón que los demás slides.
 *
 * Refresco en vivo (2026-10-05): si un admin cambia CORTE_PERIODO_COBRANZA/CONTABILIDAD desde
 * Configuraciones Globales mientras este panel ya está abierto, `config:updated` (socket, mismo
 * evento que usa config-admin.component.ts) invalida el fetch perezoso y vuelve a resolver
 * periodo-rol — sin esto, un usuario con la pestaña abierta se quedaría con el periodo viejo
 * hasta recargar.
 */
@Component({
  standalone: false,
  selector: 'app-bank-corte-panel',
  templateUrl: './bank-corte-panel.component.html',
  styleUrls: ['./bank-corte-panel.component.css'],
})
export class BankCortePanelComponent implements OnInit, OnDestroy {
  @Input() banco: string | null = null;

  data:    BankCorteConciliacion | null = null;
  loading = false;
  error   = false;

  periodoActivo: CortePeriodo = 'semanal';
  descargandoReporte = false;

  // Ledger MENSUAL del backlog (2026-10-30, tercera vuelta del diseño — reemplaza por completo
  // el chart de "antigüedad por rango de días" que el usuario descartó tras ver un mockup de
  // referencia; ver cargarLedgerMensual()/buildMensualCharts()). Independiente de `data`/
  // `periodoActivo` — solo depende de `banco`/rango de meses, ver load().
  ledgerMensual: BankLedgerMensual | null = null;
  ledgerMensualLoading = false;
  ledgerMensualError   = false;
  ledgerMensualCantidad  = 7;
  ledgerMensualMesOrigen = '';

  // 2026-10-30, quinta vuelta: el usuario pidió recortar a solo los charts que ayudan a ver
  // directo cómo suben/bajan los no identificados — "Cargados vs. identificados por mes", "Mes
  // anterior vs. mes actual" y "% identificado por mes" se sacaron (ya quedan cubiertos por la
  // tabla comparativa/KPI, no aportaban un vistazo distinto de esa lectura puntual).
  mensualChart1Data: any = { labels: [], datasets: [] }; // Pendientes al cierre de cada mes
  mensualChart4Data: any = { labels: [], datasets: [] }; // Qué se identificó cada mes
  mensualChart5Data: any = { labels: [], datasets: [] }; // Balance neto por mes
  mensualChartOptionsBasico:    any = this.buildMensualChartOptionsBasico();
  mensualChartOptionsApiladas:  any = this.buildMensualChartOptionsApiladas();
  mensualChartOptionsDiverging: any = this.buildMensualChartOptionsDiverging();

  // Toggle Mensual/Diario (2026-10-30, cuarta vuelta — mockup de referencia con 2 dashboards
  // separados, "Corte mensual" y "Día actual"). Default 'mensual': es el que ya tenía más
  // historia armada en esta sesión y responde la pregunta "¿cómo venimos este mes" antes que el
  // detalle minuto a minuto de hoy.
  vistaActiva: 'mensual' | 'diario' = 'mensual';

  cambiarVista(vista: 'mensual' | 'diario'): void {
    this.vistaActiva = vista;
  }

  // Ledger DIARIO del backlog (2026-10-30) — insumo de los charts "últimos N días" del dashboard
  // "Día actual" (no la vista protagonista, ver buildDiarioCharts) y de la comparación día
  // seleccionado vs. día anterior de los 5 KPI. Simplificado en la cuarta vuelta: ya no expone
  // filtro de mes de origen ni rango de fechas propio (el tab Hoy/Ayer de abajo ya cubre la
  // navegación temporal que hacía falta para esta vista) — `cargarLedgerDiario()` siempre pide
  // una cantidad fija de días hacia atrás. Mismo patrón perezoso (ver load()), independiente de
  // `data`.
  ledgerDiario: BankLedgerDiario | null = null;
  ledgerDiarioLoading = false;
  ledgerDiarioError   = false;

  // Ledger POR HORA (2026-10-30) — SOLO del día seleccionado (tab Hoy/Ayer). Sin `fecha` =
  // hoy en vivo; con `fecha` = ayer, cerrado. Alimenta "Movimiento por hora"/"Pendientes durante
  // el día" y el banner de alerta (detecta el quiebre de tendencia dentro del día).
  diaSeleccionado: 'hoy' | 'ayer' = 'hoy';
  ledgerPorHora: BankLedgerPorHora | null = null;
  ledgerPorHoraLoading = false;
  ledgerPorHoraError   = false;

  // Feed de actividad reciente (2026-10-30) — "Últimos movimientos" del dashboard "Día actual".
  ultimosMovimientos: BankUltimosMovimientos | null = null;
  ultimosMovimientosLoading = false;
  ultimosMovimientosError   = false;

  // 2026-10-30, quinta vuelta: "Movimiento por hora" y "Últimos N días: cargados vs.
  // identificados" se sacaron (mismo pedido de recorte que en "Corte mensual").
  diarioChartPendientesHoraData: any = { labels: [], datasets: [] }; // Pendientes durante el día
  diarioChartBalanceDiarioData: any = { labels: [], datasets: [] }; // Balance neto diario
  diarioChartPendientesDiaData: any = { labels: [], datasets: [] }; // Pendientes al cierre de cada día

  // CxC retrasadas (2026-10-22, 2da revisión): el detalle vive en un modal (`<app-modal>`,
  // shared/components/modal — mismo componente reutilizable que ya usan lealtad y
  // collection-requests) en vez de expandir inline. Antes expandía dentro del dashboard, pero
  // eso generaba el mismo tipo de salto de layout que ya se resolvió para el refresh de
  // filtros — el usuario pidió explícitamente moverlo a un contenedor aparte.
  cxcRetrasadasModalOpen = false;

  // Opciones compartidas de los 6 charts del dashboard "Corte mensual" (2026-10-30, tercera
  // vuelta — mockup de referencia que el usuario aprobó): sin datalabels por barra (el detalle
  // exacto vive en el tooltip/tabla comparativa, mismo criterio ya aplicado en el resto del
  // panel — no saturar la lectura con una cifra encima de cada barra).
  private buildMensualChartOptionsBasico(): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      scales: {
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, precision: 0 } },
      },
      plugins: {
        legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const base = `${ctx.dataset.label}: ${ctx.formattedValue}`;
              const importe = ctx.dataset.importes?.[ctx.dataIndex];
              return importe == null ? base : `${base} (${this.formatImporte(importe)})`;
            },
          },
        },
        // chartjs-plugin-datalabels está registrado a nivel módulo (ver Chart.register arriba) y
        // por default dibuja el valor crudo en CADA punto — acá se desactiva globalmente para
        // los 6 charts de "Corte mensual" (el detalle exacto vive en el tooltip/tabla
        // comparativa, nunca impreso en la barra, mismo criterio que el resto del panel).
        datalabels: { display: false },
      },
    };
  }

  /** Mismas opciones que el básico, pero con los 2 ejes apilados — para el chart "Qué se
   *  identificó cada mes" (2 segmentos: de iniciales / de nuevos). */
  private buildMensualChartOptionsApiladas(): any {
    const base = this.buildMensualChartOptionsBasico();
    return { ...base, scales: { x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true } } };
  }

  /** Para "Balance neto por mes" — centrado en 0 (positivo = el backlog crece, negativo = baja),
   *  sin leyenda (una sola serie, coloreada por barra según el signo — ver buildMensualCharts). */
  private buildMensualChartOptionsDiverging(): any {
    const base = this.buildMensualChartOptionsBasico();
    return { ...base, plugins: { ...base.plugins, legend: { display: false } } };
  }

  private periodoRolCargado = false;
  private loadTrigger$ = new Subject<void>();
  private destroy$     = new Subject<void>();

  constructor(
    private bankService: BankService,
    private toast: ToastService,
    private socket: SocketService,
  ) {}

  ngOnInit(): void {
    // Si Configuraciones Globales cambia el periodo de ESTE rol mientras el panel ya está
    // abierto, invalida el fetch perezoso y vuelve a resolverlo — mismo patrón que
    // config-admin.component.ts con este mismo evento.
    this.socket.configUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ sectionClave, clave }) => {
        if (sectionClave === 'bancos' && (clave === 'CORTE_PERIODO_COBRANZA' || clave === 'CORTE_PERIODO_CONTABILIDAD')) {
          this.periodoRolCargado = false;
          this.loadTrigger$.next();
        }
      });

    this.loadTrigger$.pipe(
      switchMap(() => {
        this.loading = true;
        this.error   = false;
        // Periodo/puedeAlternar solo se piden UNA VEZ (fetch perezoso, igual que el resto de
        // este slide): no cambian durante la vida del componente, así que recargar banco o
        // alternar periodo manualmente no debe volver a pedirlos.
        const periodoRol$: Observable<void> = this.periodoRolCargado
          ? of(undefined)
          : this.bankService.periodoCorteRol().pipe(
              map(res => {
                this.periodoActivo    = res.periodo;
                this.periodoRolCargado = true;
              }),
            );
        return periodoRol$.pipe(
          switchMap(() => this.bankService.corteConciliacion(
            this.periodoActivo, this.banco, null, null,
          )),
          catchError(() => { this.error = true; return of(null); }),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe(res => {
      this.loading = false;
      if (res) this.data = res;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Ledger mensual/diario/por hora + feed: se piden la primera vez que se cargó, o cuando
  // `banco` realmente cambia — ver load(). NO fetch automático en ngOnInit (mismo patrón
  // perezoso que periodoRolCargado arriba: solo se dispara cuando el carousel padre activa este
  // slide con load()).
  private ledgerMensualCargado = false;
  private ledgerDiarioCargado = false;
  private ledgerPorHoraCargado = false;
  private ultimosMovimientosCargado = false;

  /** Dispara el fetch — llamado por el carousel (padre) al activar/recargar este slide. */
  load(banco?: string | null): void {
    const bancoCambio = banco !== undefined && banco !== this.banco;
    if (banco !== undefined) this.banco = banco;
    this.loadTrigger$.next();
    // Ledger mensual/diario/por hora/feed solo dependen de `banco` (independientes de
    // periodo/corte histórico de getCorteConciliacion) — recargar solo la primera vez o si
    // `banco` cambió, para no repetirlas en cada load() del carousel padre (recargas periódicas
    // del slide activo).
    if (!this.ledgerMensualCargado || bancoCambio) {
      this.ledgerMensualCargado = true;
      this.cargarLedgerMensual();
    }
    if (!this.ledgerDiarioCargado || bancoCambio) {
      this.ledgerDiarioCargado = true;
      this.cargarLedgerDiario();
    }
    if (!this.ledgerPorHoraCargado || bancoCambio) {
      this.ledgerPorHoraCargado = true;
      this.cargarLedgerPorHora();
    }
    if (!this.ultimosMovimientosCargado || bancoCambio) {
      this.ultimosMovimientosCargado = true;
      this.cargarUltimosMovimientos();
    }
  }

  /** Cambio de tab Hoy/Ayer — recarga SOLO el ledger por hora (los demás paneles de "Día actual"
   *  ya muestran una ventana de varios días que incluye tanto hoy como ayer, no hace falta
   *  recargarlos). */
  cambiarDiaSeleccionado(dia: 'hoy' | 'ayer'): void {
    this.diaSeleccionado = dia;
    this.cargarLedgerPorHora();
  }

  /** Cambio del filtro "mes de origen" del ledger mensual (input nativo `type="month"`, mismo
   *  contrato que el del ledger diario). */
  onMesOrigenLedgerMensual(mesOrigen: string): void {
    this.ledgerMensualMesOrigen = mesOrigen;
    this.cargarLedgerMensual();
  }

  /** Cambio de "últimos N meses" (selector simple) — recarga el ledger mensual con la cantidad
   *  nueva, sin tocar `mesOrigen`. */
  onCantidadMesesLedgerMensual(cantidad: number): void {
    this.ledgerMensualCantidad = cantidad;
    this.cargarLedgerMensual();
  }

  abrirCxcRetrasadasModal(): void {
    this.cxcRetrasadasModalOpen = true;
  }

  cerrarCxcRetrasadasModal(): void {
    this.cxcRetrasadasModalOpen = false;
  }

  /** "septiembre 2026" a partir de un "YYYY-MM" (mesFolio de una CxC retrasada). */
  formatMesFolio(mesFolio: string): string {
    const [anio, mes] = mesFolio.split('-').map(Number);
    return new Date(anio, mes - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  }

  private cargarLedgerMensual(): void {
    this.ledgerMensualLoading = true;
    this.ledgerMensualError   = false;
    this.bankService.ledgerMensual(
      this.banco, this.ledgerMensualMesOrigen || null, null, null, this.ledgerMensualCantidad,
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.ledgerMensual       = res;
        this.ledgerMensualLoading = false;
        this.buildMensualCharts(res);
      },
      error: () => {
        this.ledgerMensualLoading = false;
        this.ledgerMensualError   = true;
      },
    });
  }

  /** 15 días (suficiente para los charts "últimos N días" de "Día actual" y para tener el día
   *  anterior al seleccionado disponible para la comparación de los 5 KPI) — sin filtro de mes
   *  de origen ni rango propio, ver comentario de `ledgerDiario` arriba. */
  private cargarLedgerDiario(): void {
    this.ledgerDiarioLoading = true;
    this.ledgerDiarioError   = false;
    this.bankService.ledgerDiario(this.banco, null, null, null, 15)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          this.ledgerDiario       = res;
          this.ledgerDiarioLoading = false;
          this.buildDiarioChartsDeDias(res);
        },
        error: () => {
          this.ledgerDiarioLoading = false;
          this.ledgerDiarioError   = true;
        },
      });
  }

  /** `fecha` que se le manda a `ledger-por-hora` según el tab activo — `null` (hoy, en vivo) o
   *  ayer en formato `YYYY-MM-DD` (hora México, nunca el día del navegador del usuario). */
  private get fechaParaLedgerPorHora(): string | null {
    if (this.diaSeleccionado === 'hoy') return null;
    const hoyMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    const ayer = new Date(`${hoyMx}T12:00:00`);
    ayer.setDate(ayer.getDate() - 1);
    return ayer.toLocaleDateString('en-CA');
  }

  private cargarLedgerPorHora(): void {
    this.ledgerPorHoraLoading = true;
    this.ledgerPorHoraError   = false;
    this.bankService.ledgerPorHora(this.banco, this.fechaParaLedgerPorHora)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          this.ledgerPorHora       = res;
          this.ledgerPorHoraLoading = false;
          this.buildDiarioChartsDeHoras(res);
        },
        error: () => {
          this.ledgerPorHoraLoading = false;
          this.ledgerPorHoraError   = true;
        },
      });
  }

  private cargarUltimosMovimientos(): void {
    this.ultimosMovimientosLoading = true;
    this.ultimosMovimientosError   = false;
    this.bankService.ultimosMovimientos(this.banco, 10)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          this.ultimosMovimientos       = res;
          this.ultimosMovimientosLoading = false;
        },
        error: () => {
          this.ultimosMovimientosLoading = false;
          this.ultimosMovimientosError   = true;
        },
      });
  }

  /** Último mes del arreglo (mes EN CURSO, incluido en vivo — ver getLedgerMensual en el
   *  backend). `null` antes de cargar. */
  get mesActual(): BankLedgerMesItem | null {
    const meses = this.ledgerMensual?.meses;
    return meses && meses.length > 0 ? meses[meses.length - 1] : null;
  }

  /** Anteúltimo mes — base de la comparativa "mes anterior vs. mes actual". `null` si solo hay
   *  un mes cargado (ej. `cantidad=1`). */
  get mesAnterior(): BankLedgerMesItem | null {
    const meses = this.ledgerMensual?.meses;
    return meses && meses.length > 1 ? meses[meses.length - 2] : null;
  }

  /** Día del mes en curso / total de días de ese mes — para la barra de progreso "Días
   *  transcurridos del mes" (calculable en el frontend, no hace falta nada del backend). */
  get diasTranscurridosMes(): { actual: number; total: number } {
    const hoy = new Date();
    return { actual: hoy.getDate(), total: new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate() };
  }

  /** % de `parte` sobre `base`, o `null` si `base` es 0 (nunca dividir por cero) — usado para
   *  los 5 KPI y el banner de alerta. */
  private pct(parte: number, base: number): number | null {
    return base > 0 ? (parte / base) * 100 : null;
  }

  /** 5 KPI del mockup aprobado por el usuario: valor del mes actual, delta vs. el anterior, y
   *  calificación mejor/peor/igual (color) — "Nuevos no identificados" queda sin calificación de
   *  bueno/malo a propósito, es volumen de entrada, no un resultado del equipo. */
  get kpisMensuales(): Array<{
    label: string; valor: number; detalle: string; deltaTexto: string;
    calificacion: 'mejor' | 'peor' | 'igual';
  }> {
    const actual = this.mesActual;
    if (!actual) return [];
    const anterior = this.mesAnterior;

    const pctInicialesActual   = this.pct(actual.identificadosDeIniciales.count, actual.iniciales.count);
    const pctInicialesAnterior = anterior ? this.pct(anterior.identificadosDeIniciales.count, anterior.iniciales.count) : null;
    const pctNuevosActual      = this.pct(actual.identificadosDeNuevos.count, actual.nuevos.count);
    const pctNuevosAnterior    = anterior ? this.pct(anterior.identificadosDeNuevos.count, anterior.nuevos.count) : null;

    const deltaTexto = (actualVal: number, anteriorVal?: number): string =>
      anteriorVal == null ? '' : `${actualVal - anteriorVal >= 0 ? '+' : ''}${actualVal - anteriorVal} vs ${anteriorVal}`;
    const calificaMenorEsMejor = (actualVal: number, anteriorVal?: number): 'mejor' | 'peor' | 'igual' =>
      anteriorVal == null ? 'igual' : actualVal < anteriorVal ? 'mejor' : actualVal > anteriorVal ? 'peor' : 'igual';
    const calificaPct = (actualPct: number | null, anteriorPct?: number | null): 'mejor' | 'peor' | 'igual' =>
      actualPct == null || anteriorPct == null ? 'igual' : actualPct > anteriorPct ? 'mejor' : actualPct < anteriorPct ? 'peor' : 'igual';

    return [
      {
        label: 'No identificados iniciales', valor: actual.iniciales.count,
        detalle: this.formatImporteCompacto(actual.iniciales.saldo),
        deltaTexto: deltaTexto(actual.iniciales.count, anterior?.iniciales.count),
        calificacion: calificaMenorEsMejor(actual.iniciales.count, anterior?.iniciales.count),
      },
      {
        label: 'Iniciales identificados', valor: actual.identificadosDeIniciales.count,
        detalle: pctInicialesActual == null ? '—' : `${pctInicialesActual.toFixed(1)}% de los iniciales`,
        deltaTexto: pctInicialesActual != null && pctInicialesAnterior != null
          ? `${(pctInicialesActual - pctInicialesAnterior) >= 0 ? '+' : ''}${(pctInicialesActual - pctInicialesAnterior).toFixed(1)} pp` : '',
        calificacion: calificaPct(pctInicialesActual, pctInicialesAnterior),
      },
      {
        label: 'Nuevos no identificados', valor: actual.nuevos.count,
        detalle: 'cargados en el mes',
        deltaTexto: deltaTexto(actual.nuevos.count, anterior?.nuevos.count),
        calificacion: 'igual', // volumen de entrada: no es un resultado bueno/malo del equipo
      },
      {
        label: 'Nuevos identificados', valor: actual.identificadosDeNuevos.count,
        detalle: pctNuevosActual == null ? '—' : `${pctNuevosActual.toFixed(1)}% de los nuevos`,
        deltaTexto: pctNuevosActual != null && pctNuevosAnterior != null
          ? `${(pctNuevosActual - pctNuevosAnterior) >= 0 ? '+' : ''}${(pctNuevosActual - pctNuevosAnterior).toFixed(1)} pp` : '',
        calificacion: calificaPct(pctNuevosActual, pctNuevosAnterior),
      },
      {
        label: 'Pendientes al cierre', valor: actual.total.count,
        detalle: `${actual.iniciales.count - actual.identificadosDeIniciales.count} iniciales + ${actual.nuevos.count - actual.identificadosDeNuevos.count} nuevos`,
        deltaTexto: deltaTexto(actual.total.count, anterior?.total.count),
        calificacion: calificaMenorEsMejor(actual.total.count, anterior?.total.count),
      },
    ];
  }

  /** Banner de alerta (2026-10-30, mockup aprobado por el usuario): compara el mes actual contra
   *  el anterior y arma una frase en español — nada de esto le pide nada nuevo al backend, son
   *  los mismos `meses[]` que ya alimentan los charts. `null` con menos de 2 meses cargados (no
   *  hay "anterior" con qué comparar). */
  get bannerMensual(): { texto: string; tipo: 'warn' | 'neutral' } | null {
    const meses = this.ledgerMensual?.meses;
    if (!meses || meses.length < 2) return null;
    const actual = meses[meses.length - 1];
    const anterior = meses[meses.length - 2];
    const deltaTotal = actual.total.count - anterior.total.count;
    const subioPendientes = deltaTotal > 0;

    // Racha ya rota por el mes actual: cuenta hacia atrás, desde el anterior, cuántos meses
    // seguidos venían en la dirección CONTRARIA a lo que hizo el mes actual.
    let racha = 0;
    for (let i = meses.length - 2; i > 0; i--) {
      const delta = meses[i].total.count - meses[i - 1].total.count;
      const veniaBajando = delta <= 0;
      if (subioPendientes ? veniaBajando : !veniaBajando) racha++; else break;
    }

    const pctIniActual = this.pct(actual.identificadosDeIniciales.count, actual.iniciales.count);
    const pctIniAnterior = this.pct(anterior.identificadosDeIniciales.count, anterior.iniciales.count);
    const pctNueActual = this.pct(actual.identificadosDeNuevos.count, actual.nuevos.count);
    const pctNueAnterior = this.pct(anterior.identificadosDeNuevos.count, anterior.nuevos.count);

    let texto = `Los pendientes ${subioPendientes ? 'crecieron' : deltaTotal < 0 ? 'bajaron' : 'se mantuvieron'} ${Math.abs(deltaTotal)} depósito${Math.abs(deltaTotal) === 1 ? '' : 's'} en ${this.formatMesLargo(actual.mes)}`;
    if (racha > 0) texto += `, después de ${racha} mes${racha === 1 ? '' : 'es'} seguido${racha === 1 ? '' : 's'} ${subioPendientes ? 'a la baja' : 'al alza'}`;
    texto += '.';
    if (pctIniActual != null && pctIniAnterior != null) {
      texto += ` La identificación de iniciales ${pctIniActual >= pctIniAnterior ? 'subió' : 'cayó'} de ${pctIniAnterior.toFixed(1)}% a ${pctIniActual.toFixed(1)}%`;
    }
    if (pctNueActual != null && pctNueAnterior != null) {
      texto += `${pctIniActual != null && pctIniAnterior != null ? ' y el' : ' El'} % de nuevos identificados ${pctNueActual >= pctNueAnterior ? 'subió' : 'bajó'} de ${pctNueAnterior.toFixed(1)}% a ${pctNueActual.toFixed(1)}%`;
    }
    texto += '.';

    return { texto, tipo: subioPendientes ? 'warn' : 'neutral' };
  }

  // 3 charts del dashboard "Corte mensual" (2026-10-30, quinta vuelta — recortado de 6 a 3 a
  // pedido del usuario: solo los que ayudan a ver directo cómo suben/bajan los no identificados),
  // todos sobre `ledger.meses`. Colores: azul (`#2a78d6`, identificados/lectura neutra), naranja
  // (`#d9730d`, "entra más de lo que sale"/alerta).
  private buildMensualCharts(ledger: BankLedgerMensual): void {
    const meses = ledger.meses;
    const labels = meses.map(m => this.formatMesCortoMensual(m.mes));
    const esMesActual = (i: number) => i === meses.length - 1;

    this.mensualChart1Data = {
      labels,
      datasets: [{
        type: 'bar', label: 'Pendientes al cierre', data: meses.map(m => m.total.count),
        backgroundColor: meses.map((_, i) => esMesActual(i) ? '#d9730d' : '#2a78d6'),
        importes: meses.map(m => m.total.saldo),
      }],
    };

    this.mensualChart4Data = {
      labels,
      datasets: [
        { type: 'bar', label: 'Identificados — de iniciales', data: meses.map(m => m.identificadosDeIniciales.count), backgroundColor: '#5598e7', importes: meses.map(m => m.identificadosDeIniciales.saldo), stack: 'id' },
        { type: 'bar', label: 'Identificados — de nuevos', data: meses.map(m => m.identificadosDeNuevos.count), backgroundColor: '#104281', importes: meses.map(m => m.identificadosDeNuevos.saldo), stack: 'id' },
      ],
    };

    const balance = meses.map(m => m.nuevos.count - m.identificados.count);
    this.mensualChart5Data = {
      labels,
      datasets: [{
        type: 'bar', label: 'Cargados − identificados', data: balance,
        backgroundColor: balance.map(v => v > 0 ? '#d9730d' : '#2a78d6'),
      }],
    };
  }

  /** 'oct 26' a partir de un 'YYYY-MM' — labels de los 6 charts (año de 2 dígitos: son solo
   *  meses recientes, no hace falta el año completo). */
  private formatMesCortoMensual(mes: string): string {
    const [anio, m] = mes.split('-').map(Number);
    return new Date(anio, m - 1, 1).toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
  }

  /** 'octubre de 2026' a partir de un 'YYYY-MM' — para el banner de alerta y la tabla
   *  comparativa (nombres de columna). */
  formatMesLargo(mes: string): string {
    const [anio, m] = mes.split('-').map(Number);
    return new Date(anio, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  }

  /** Saldo compacto (ej. "$452 mil", "$1.2 M") para los KPI del ledger mensual/diario —
   *  `Intl.NumberFormat` con `notation:'compact'` en es-MX, nunca abreviaturas en inglés (K/M)
   *  hardcodeadas a mano. */
  formatImporteCompacto(value: number): string {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1,
    }).format(value);
  }

  // ── Dashboard "Día actual" (2026-10-30, cuarta vuelta — mockup de referencia con 2 charts por
  // hora + 2 por día + feed de actividad). Colores consistentes con "Corte mensual": azul
  // `#2a78d6` = identificados/lectura neutra, naranja `#d9730d` = "entra más de lo que sale".

  /** Día seleccionado (tab Hoy/Ayer) dentro de `ledgerDiario.dias` — hoy es SIEMPRE el último
   *  elemento (incluido en vivo, ver getLedgerDiario), ayer el anteúltimo. */
  get diaActualLedger(): BankLedgerDiaItem | null {
    const dias = this.ledgerDiario?.dias;
    if (!dias || dias.length === 0) return null;
    const idx = this.diaSeleccionado === 'hoy' ? dias.length - 1 : dias.length - 2;
    return dias[idx] ?? null;
  }

  /** El día ANTERIOR al seleccionado — base de la comparación de los 5 KPI (mismo criterio que
   *  `mesAnterior` en "Corte mensual"). */
  get diaAnteriorLedger(): BankLedgerDiaItem | null {
    const dias = this.ledgerDiario?.dias;
    if (!dias || dias.length === 0) return null;
    const idx = this.diaSeleccionado === 'hoy' ? dias.length - 2 : dias.length - 3;
    return dias[idx] ?? null;
  }

  /** Total pendiente a la apertura del día seleccionado — primera hora de `ledgerPorHora.horas`
   *  (el backlog con el que arrancó el día, antes de cualquier movimiento). */
  get aperturaDelDia(): number | null {
    const horas = this.ledgerPorHora?.horas;
    return horas && horas.length > 0 ? horas[0].total.count : null;
  }

  /** 5 KPI del dashboard "Día actual" (mismo criterio de delta+calificación que `kpisMensuales`
   *  en "Corte mensual"): valor del día seleccionado, delta vs. el día anterior, calificación
   *  mejor/peor/igual — "Nuevos cargados hoy" queda sin calificación de bueno/malo, es volumen
   *  de entrada, no un resultado del equipo (mismo criterio que "Nuevos no identificados" en la
   *  vista mensual). */
  get kpisDiarios(): Array<{
    label: string; valor: number; detalle: string; deltaTexto: string;
    calificacion: 'mejor' | 'peor' | 'igual';
  }> {
    const actual = this.diaActualLedger;
    if (!actual) return [];
    const anterior = this.diaAnteriorLedger;
    const apertura = this.aperturaDelDia;

    const pctNuevosActual   = this.pct(actual.identificadosDeNuevos.count, actual.nuevos.count);
    const pctInicialesActual = this.pct(actual.identificadosDeIniciales.count, actual.iniciales.count);

    const deltaTexto = (actualVal: number, anteriorVal?: number): string =>
      anteriorVal == null ? '' : `${actualVal - anteriorVal >= 0 ? '+' : ''}${actualVal - anteriorVal} vs ${anteriorVal}`;
    const calificaMenorEsMejor = (actualVal: number, anteriorVal?: number): 'mejor' | 'peor' | 'igual' =>
      anteriorVal == null ? 'igual' : actualVal < anteriorVal ? 'mejor' : actualVal > anteriorVal ? 'peor' : 'igual';

    return [
      {
        label: 'Pendientes ahora', valor: actual.total.count,
        detalle: apertura == null ? '—' : `apertura del día: ${apertura}`,
        deltaTexto: apertura == null ? '' : `${actual.total.count - apertura >= 0 ? '+' : ''}${actual.total.count - apertura} en el día`,
        calificacion: apertura == null ? 'igual' : actual.total.count < apertura ? 'mejor' : actual.total.count > apertura ? 'peor' : 'igual',
      },
      {
        label: 'Nuevos cargados', valor: actual.nuevos.count,
        detalle: this.formatImporteCompacto(actual.nuevos.saldo),
        deltaTexto: deltaTexto(actual.nuevos.count, anterior?.nuevos.count),
        calificacion: 'igual', // volumen de entrada: no es un resultado bueno/malo del equipo
      },
      {
        label: 'Identificados', valor: actual.identificados.count,
        detalle: `${actual.identificadosDeIniciales.count} de iniciales + ${actual.identificadosDeNuevos.count} de nuevos`,
        deltaTexto: deltaTexto(actual.identificados.count, anterior?.identificados.count),
        calificacion: anterior == null ? 'igual' : actual.identificados.count > anterior.identificados.count ? 'mejor' : actual.identificados.count < anterior.identificados.count ? 'peor' : 'igual',
      },
      {
        label: 'Nuevos pendientes', valor: actual.nuevos.count - actual.identificadosDeNuevos.count,
        detalle: pctNuevosActual == null ? '—' : `${pctNuevosActual.toFixed(1)}% ya identificados`,
        deltaTexto: '',
        calificacion: calificaMenorEsMejor(actual.nuevos.count - actual.identificadosDeNuevos.count, anterior ? anterior.nuevos.count - anterior.identificadosDeNuevos.count : undefined),
      },
      {
        label: 'Iniciales identificados', valor: actual.identificadosDeIniciales.count,
        detalle: pctInicialesActual == null ? '—' : `${pctInicialesActual.toFixed(1)}% de los iniciales`,
        deltaTexto: deltaTexto(actual.identificadosDeIniciales.count, anterior?.identificadosDeIniciales.count),
        calificacion: anterior == null ? 'igual' : actual.identificadosDeIniciales.count > anterior.identificadosDeIniciales.count ? 'mejor' : actual.identificadosDeIniciales.count < anterior.identificadosDeIniciales.count ? 'peor' : 'igual',
      },
    ];
  }

  /** Banner de alerta de "Día actual" (mismo espíritu que `bannerMensual`, texto armado en el
   *  frontend a partir de `ledgerPorHora.horas`, sin pedirle nada nuevo al backend): detecta la
   *  hora donde el `total.count` deja de subir y empieza a bajar (o viceversa) — si no hay un
   *  quiebre claro (todo sube o todo baja parejo), describe solo el delta del día. */
  get bannerDiario(): { texto: string; tipo: 'warn' | 'neutral' } | null {
    const horas = this.ledgerPorHora?.horas;
    if (!horas || horas.length < 2) return null;
    const apertura = horas[0].total.count;
    const actual   = horas[horas.length - 1].total.count;
    const deltaDia = actual - apertura;

    // Última racha de signo constante en las deltas hora a hora, leída desde el final — "el
    // quiebre" es el punto donde esa racha arrancó.
    let signoRacha: number | null = null;
    let inicioRachaIdx = horas.length - 1;
    for (let i = horas.length - 1; i > 0; i--) {
      const delta = horas[i].total.count - horas[i - 1].total.count;
      const signo = delta > 0 ? 1 : delta < 0 ? -1 : 0;
      if (signo === 0) continue; // sin cambio esa hora, no rompe ni confirma la racha
      if (signoRacha === null) { signoRacha = signo; inicioRachaIdx = i - 1; }
      else if (signo === signoRacha) { inicioRachaIdx = i - 1; }
      else break;
    }

    let texto: string;
    // Racha real (empieza después de la apertura) Y de al menos 2 horas de diferencia con el
    // total actual — un quiebre de 1 hora no amerita la cláusula "desde las H...".
    if (signoRacha !== null && inicioRachaIdx > 0 && inicioRachaIdx < horas.length - 1) {
      const valorEnQuiebre = horas[inicioRachaIdx].total.count;
      const bajando = signoRacha < 0;
      texto = `Desde las ${horas[inicioRachaIdx].hora} los pendientes del día ${bajando ? 'bajan' : 'suben'} (${valorEnQuiebre} → ${actual}): el equipo ${bajando ? 'ya identifica más de lo que entra' : 'está recibiendo más de lo que identifica'}.`;
      texto += ` Aun así el día ${this.diaSeleccionado === 'hoy' ? 'va' : 'cerró'} con ${deltaDia >= 0 ? '+' : ''}${deltaDia} contra la apertura.`;
    } else {
      texto = `Los pendientes del día ${deltaDia > 0 ? 'suben' : deltaDia < 0 ? 'bajan' : 'se mantienen'} ${Math.abs(deltaDia)} depósito${Math.abs(deltaDia) === 1 ? '' : 's'} contra la apertura (${apertura} → ${actual}).`;
    }

    return { texto, tipo: deltaDia > 0 ? 'warn' : 'neutral' };
  }

  /** Pendientes durante el día (línea de `total`) sobre `ledgerPorHora.horas`, el día
   *  seleccionado (Hoy/Ayer) — "Movimiento por hora" se sacó (2026-10-30, quinta vuelta, pedido
   *  de recorte del usuario: no aportaba a la lectura de cómo suben/bajan los no identificados). */
  private buildDiarioChartsDeHoras(ledger: BankLedgerPorHora): void {
    const labels = ledger.horas.map(h => h.hora);
    this.diarioChartPendientesHoraData = {
      labels,
      datasets: [{
        type: 'line', label: 'Pendientes', data: ledger.horas.map(h => h.total.count),
        borderColor: '#2a78d6', backgroundColor: '#2a78d6', tension: 0.15, pointRadius: 3,
        importes: ledger.horas.map(h => h.total.saldo),
      }],
    };
  }

  /** Balance neto diario + Pendientes al cierre de cada día — sobre `ledgerDiario.dias`.
   *  "Últimos N días: cargados vs. identificados" se sacó (mismo recorte de arriba). */
  private buildDiarioChartsDeDias(ledger: BankLedgerDiario): void {
    const labels = ledger.dias.map(d => this.formatFechaCorta(d.fecha));

    const balance = ledger.dias.map(d => d.nuevos.count - d.identificados.count);
    this.diarioChartBalanceDiarioData = {
      labels,
      datasets: [{
        type: 'bar', label: 'Cargados − identificados', data: balance,
        backgroundColor: balance.map(v => v > 0 ? '#d9730d' : '#2a78d6'),
      }],
    };

    this.diarioChartPendientesDiaData = {
      labels,
      datasets: [{
        type: 'line', label: 'Pendientes al cierre', data: ledger.dias.map(d => d.total.count),
        borderColor: '#2a78d6', backgroundColor: '#2a78d6', tension: 0.15, pointRadius: 3,
        importes: ledger.dias.map(d => d.total.saldo),
      }],
    };
  }

  /** "17/10" — fecha corta sin año, labels de los charts "por día" de "Día actual" (no mira tan
   *  atrás como para necesitar el año). */
  private formatFechaCorta(fechaIso: string): string {
    return new Date(fechaIso).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short' });
  }

  /** "16:32" — hora de un evento del feed "Últimos movimientos", hora México explícita (mismo
   *  criterio que el resto del panel: el navegador del usuario puede correr en cualquier TZ). */
  formatHoraEvento(fechaIso: string): string {
    return new Date(fechaIso).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });
  }

  /** "Nuevo" o "Inicial · sep" para la columna Tipo del feed — `mesOrigen` formateado corto,
   *  solo relevante cuando `tipo==='inicial'` (ver JSDoc de `BankUltimoMovimientoItem`). */
  formatTipoMovimiento(item: BankUltimoMovimientoItem): string {
    if (item.tipo === 'nuevo') return 'Nuevo';
    const [anio, mes] = item.mesOrigen.split('-').map(Number);
    const mesCorto = new Date(anio, mes - 1, 1).toLocaleDateString('es-MX', { month: 'short' }).replace('.', '');
    return `Inicial · ${mesCorto}`;
  }

  /** Mismo formato que la columna "Importe" de CxC retrasadas (`currency:'MXN':'symbol':'1.2-2'`)
   *  — acá vía Intl directo porque el tooltip de Chart.js corre fuera de un binding de plantilla,
   *  no hay forma de usar el pipe de Angular ahí. */
  private formatImporte(value: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }

  /** "lunes 5 de octubre" / "1 de octubre" — sin hora, sin año (el periodo nunca es tan
   *  viejo como para necesitarlo). `timeZone` explícito: el `inicio` que manda el backend
   *  ya es el instante UTC correcto de medianoche México, pero el navegador del usuario
   *  puede correr en cualquier TZ — sin esto, un navegador fuera de México podría mostrar
   *  el día anterior o siguiente. */
  formatInicio(inicioIso: string): string {
    const d = new Date(inicioIso);
    const texto = d.toLocaleDateString('es-MX', {
      timeZone: 'America/Mexico_City',
      day: 'numeric', month: 'long',
      weekday: this.periodoActivo === 'semanal' ? 'long' : undefined,
    });
    return texto;
  }

  /** Mismo patrón que descargarBlob() en bank-cobranza-panel.component.ts: blob ->
   *  URL.createObjectURL -> click en <a> temporal -> revoke. */
  descargarReporte(): void {
    if (this.descargandoReporte) return;
    this.descargandoReporte = true;
    const fecha = new Date().toISOString().slice(0, 10);
    this.bankService.reporteCorte(
      this.periodoActivo, this.banco, null, null,
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = `Corte-Conciliacion-${fecha}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.descargandoReporte = false;
      },
      error: () => {
        this.descargandoReporte = false;
        this.toast.error('No se pudo generar el reporte.');
      },
    });
  }
}
