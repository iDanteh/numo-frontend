import { Component, Input, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Chart, ChartEvent } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { BankService } from '../../../../core/services/bank.service';
import {
  BankLedgerBacklog, BankLedgerDiaItem, BankLedgerDiario, BankLedgerMensual,
  BankLedgerMesItem, BankAntiguedadDepositos,
} from '../../../../core/models/bank.model';

// Registrado una sola vez a nivel módulo — `provideCharts(withDefaultRegisterables())` en
// banks.module.ts registra los controladores base de Chart.js, pero datalabels es un plugin
// aparte que no viene incluido ahí. Por default dibuja el valor crudo en cada punto — cada chart
// de este componente lo desactiva explícitamente (`plugins.datalabels.display:false` o
// `datalabels:{display:false}` por dataset) salvo que necesite una etiqueta puntual.
Chart.register(ChartDataLabels);

/**
 * Slide del dashboard de Bancos — "Cortes": identificación de depósitos contra CxC, basado
 * íntegramente en un mockup de referencia que el usuario considera "la propuesta establecida"
 * (2026-11-06) — no queda ningún elemento de las iteraciones de diseño anteriores (corte
 * semanal/mensual por rol, hero de 3 estadísticas, CxC retrasadas, banners/KPI con delta,
 * feed de últimos movimientos, toggle Hoy/Ayer con ledger por hora): todo lo que no está en el
 * mockup se eliminó a pedido explícito del usuario, no solo se ocultó.
 *
 * 3 vistas (`vistaActiva`): Mensual y Diario (mismo patrón — 2 charts, "Resultado de X", tabla
 * comparativa de 11 columnas) y Antigüedad (4 rangos de días, corte siempre "hoy"). El ledger
 * mensual arranca siempre en mayo de 2026 (`LEDGER_MENSUAL_DESDE`, ver esa constante) — mes fijo,
 * no una ventana rodante.
 */
@Component({
  standalone: false,
  selector: 'app-bank-corte-panel',
  templateUrl: './bank-corte-panel.component.html',
  styleUrls: ['./bank-corte-panel.component.css'],
})
export class BankCortePanelComponent implements OnDestroy {
  @Input() banco: string | null = null;

  // Ledger MENSUAL del backlog (2026-10-30, tercera vuelta del diseño — ver
  // cargarLedgerMensual()/buildMensualCharts()). Solo depende de `banco`/rango de meses, ver
  // load().
  ledgerMensual: BankLedgerMensual | null = null;
  ledgerMensualLoading = false;
  ledgerMensualError   = false;
  ledgerMensualMesOrigen = '';

  // Ancla fija del ledger mensual (2026-11-06, verificada 2 veces contra una copia real de la
  // base de producción — primer intento con `primeraIdentificacionAt` dio agosto, FALSO: ese
  // campo se agregó al código el 2026-08-14 (un día antes de su propio "mínimo"), así que nunca
  // pudo capturar identificaciones anteriores — 30,383 depósitos `identificado` ni siquiera
  // tienen ese campo. La señal correcta es `identificadoPor[].fechaId` (existe desde el commit
  // inicial del proyecto, sin ese problema), excluyendo `nombre:'Motor ERP'` (sync puntual de
  // backfill histórico, 22-may al 9-jun-2026, no actividad real). Con eso: primera identificación
  // humana real el 2026-05-06 (folio Numo 020971, usuaria cristiangarcia — dato que dio el
  // usuario y quedó confirmado), con volumen sostenido desde ese mes (7,512 en mayo). Mayo SÍ es
  // el mes correcto — antes no hay actividad de identificación que comparar, así que mayo absorbe
  // todo lo acumulado antes como su "saldo inicial" natural. A diferencia de la "cantidad"
  // (ventana rodante de últimos N meses, selector que existía acá y se quitó por quedar sin
  // efecto) que usaba este ledger hasta ahora, esto es un mes FIJO: pasarle `desde` al backend
  // hace que ignore `cantidad` por completo (ver _enumerarMesesParaLedger en
  // bank-indicadores.service.js) y enumere TODOS los meses desde mayo hasta el mes en curso, sin
  // importar cuántos sean.
  private readonly LEDGER_MENSUAL_DESDE = '2026-05';

  // 2 charts de "Corte mensual"/"Día actual" (2026-11-06, mockup de referencia más establecido:
  // reemplaza la grilla de 3 charts anterior) — "Montos por X"/"Número de depósitos por X", barra
  // apilada identificados (abajo) + saldo final (arriba), con el total ("al cierre" = saldo
  // inicial + nuevos) impreso arriba de la barra vía datalabels por dataset (ver
  // buildMensualCharts()/buildDiarioChartsDeDias()). Mismo criterio de colores que el resto del
  // panel: azul = identificados/lectura neutra, naranja = lo que queda sin identificar.
  montosPorMesChartData: any = { labels: [], datasets: [] };
  movsPorMesChartData:   any = { labels: [], datasets: [] };
  montosPorDiaChartData: any = { labels: [], datasets: [] };
  movsPorDiaChartData:   any = { labels: [], datasets: [] };
  mensualChartOptionsBasico:   any = this.buildMensualChartOptionsBasico();
  mensualChartOptionsApiladas: any = this.buildMensualChartOptionsApiladas();

  // Mes/día elegido por click en una barra de los charts de arriba o en una fila de la tabla
  // comparativa (2026-11-06, mockup de referencia) — `null` = todavía no se clickeó nada, usa el
  // más reciente (ver getters `mesResultado`/`diaResultado` más abajo).
  mesResultadoSeleccionado: string | null = null;
  diaResultadoSeleccionado: string | null = null;

  seleccionarMes(mes: string): void { this.mesResultadoSeleccionado = mes; }
  seleccionarDia(fecha: string): void { this.diaResultadoSeleccionado = fecha; }

  /** Click en una barra de "Montos por mes"/"Número de depósitos por mes" — mismo efecto que
   *  clickear la fila correspondiente de la tabla comparativa. `event.active[0].index` es el
   *  índice dentro de `ledgerMensual.meses` (mismo orden que las labels del chart). El tipo del
   *  parámetro es EXACTAMENTE el que emite `(chartClick)` de ng2-charts (`active?: object[]`,
   *  sin `index` tipado) — se castea puntual al leerlo, porque en runtime cada elemento activo
   *  de Chart.js sí trae `index`, pero su declaración de tipos no lo expone. */
  onClickMesChart(event: { event?: ChartEvent; active?: object[] }): void {
    const idx = (event?.active?.[0] as { index?: number } | undefined)?.index;
    const mes = idx != null ? this.ledgerMensual?.meses[idx]?.mes : null;
    if (mes) this.seleccionarMes(mes);
  }

  /** Mismo criterio que `onClickMesChart()`, para "Montos por día"/"Número de depósitos por día". */
  onClickDiaChart(event: { event?: ChartEvent; active?: object[] }): void {
    const idx = (event?.active?.[0] as { index?: number } | undefined)?.index;
    const fecha = idx != null ? this.ledgerDiario?.dias[idx]?.fecha : null;
    if (fecha) this.seleccionarDia(fecha);
  }

  /** Mes elegido (click en chart/tabla) o, por default, el mes en curso (último del arreglo).
   *  `null` antes de cargar. Alimenta "Resultado de [mes]". */
  get mesResultado(): BankLedgerMesItem | null {
    const meses = this.ledgerMensual?.meses;
    if (!meses || meses.length === 0) return null;
    return meses.find(m => m.mes === this.mesResultadoSeleccionado) ?? meses[meses.length - 1];
  }

  /** Mismo criterio que `mesResultado()`, para "Resultado del [día]". */
  get diaResultado(): BankLedgerDiaItem | null {
    const dias = this.ledgerDiario?.dias;
    if (!dias || dias.length === 0) return null;
    return dias.find(d => d.fecha === this.diaResultadoSeleccionado) ?? dias[dias.length - 1];
  }

  /** "= Al cierre" (saldo inicial + nuevos) — el backend no lo trae armado (`BankLedgerBacklog`
   *  solo expone iniciales/nuevos/identificados/total), se suma acá para la fórmula completa del
   *  mockup de referencia ("Resultado de X" y la tabla comparativa). */
  alCierre(item: BankLedgerBacklog): { count: number; saldo: number } {
    return {
      count: item.iniciales.count + item.nuevos.count,
      saldo: item.iniciales.saldo + item.nuevos.saldo,
    };
  }

  /** Último día de `ledgerDiario.dias` — SIEMPRE "hoy" (el ledger diario lo incluye en vivo).
   *  Alimenta el encabezado único "Saldo por identificar al [hoy]" del mockup de referencia,
   *  arriba de los 3 tabs. `null` antes de cargar. */
  get hoyLedger(): BankLedgerDiaItem | null {
    const dias = this.ledgerDiario?.dias;
    return dias && dias.length > 0 ? dias[dias.length - 1] : null;
  }

  // Toggle Mensual/Diario/Antigüedad (2026-10-30, cuarta vuelta — mockup de referencia con 2
  // dashboards separados, "Corte mensual" y "Día actual"; 2026-11-06: se agrega "Antigüedad",
  // ver comentario de `antiguedad` más abajo). Default 'mensual': es el que ya tenía más
  // historia armada en esta sesión y responde la pregunta "¿cómo venimos este mes" antes que el
  // detalle minuto a minuto de hoy.
  vistaActiva: 'mensual' | 'diario' | 'antiguedad' = 'mensual';

  cambiarVista(vista: 'mensual' | 'diario' | 'antiguedad'): void {
    this.vistaActiva = vista;
  }

  // Antigüedad del backlog "completamente vacío" (2026-11-06, pedido explícito del usuario tras
  // revisar un mockup de referencia): retoma la idea de buckets por rango de días (1 a 30 / 31 a
  // 60 / 61 a 90 / más de 90) que se había descartado el 30-oct para el dashboard mensual/diario
  // de arriba, con 2 correcciones de diseño sobre esa primera versión — ver
  // bank-indicadores.service.js#getAntiguedadDepositos: agrupa por la fecha del depósito en el
  // banco (no la fecha de carga a Numo), y exige el depósito COMPLETAMENTE vacío (sin ninguna
  // CxC vinculada, ni un pago parcial en curso) — un depósito con PPD en curso sigue en
  // `no_identificado` pero ya no está "vacío". Corte siempre "hoy" — el usuario pidió
  // explícitamente simplificar, sin fecha de corte seleccionable (el mockup de referencia
  // ofrecía elegir un día/año pasado, reconstruir eso requeriría caminar
  // `historialVinculacion[]` en el backend, fuera de alcance de esta vuelta).
  antiguedad: BankAntiguedadDepositos | null = null;
  antiguedadLoading = false;
  antiguedadError   = false;
  antiguedadChartData: any = { labels: [], datasets: [] };
  antiguedadChartOptions: any = this.buildMensualChartOptionsBasico();

  // Ledger DIARIO del backlog (2026-10-30) — alimenta la vista "Diario" (charts/resultado/tabla)
  // y `hoyLedger` (encabezado único). `cargarLedgerDiario()` siempre pide una cantidad fija de
  // días hacia atrás. Mismo patrón perezoso, ver load().
  ledgerDiario: BankLedgerDiario | null = null;
  ledgerDiarioLoading = false;
  ledgerDiarioError   = false;

  // Opciones compartidas de los charts del dashboard "Corte mensual" (2026-10-30, tercera
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

  /** Mismas opciones que el básico, pero con los 2 ejes apilados — para los 4 charts de
   *  "Montos"/"Número de depósitos" por mes/día (2 segmentos: identificados / saldo final). */
  private buildMensualChartOptionsApiladas(): any {
    const base = this.buildMensualChartOptionsBasico();
    return { ...base, scales: { x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true } } };
  }

  private destroy$ = new Subject<void>();

  constructor(private bankService: BankService) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Ledger mensual/diario/antigüedad: se piden la primera vez que se cargó, o cuando `banco`
  // realmente cambia — ver load(). Sin fetch automático al crear el componente, solo cuando el
  // carousel padre activa este slide con load().
  private ledgerMensualCargado = false;
  private ledgerDiarioCargado = false;
  private antiguedadCargado = false;

  /** Dispara el fetch — llamado por el carousel (padre) al activar/recargar este slide. */
  load(banco?: string | null): void {
    const bancoCambio = banco !== undefined && banco !== this.banco;
    if (banco !== undefined) this.banco = banco;
    if (!this.ledgerMensualCargado || bancoCambio) {
      this.ledgerMensualCargado = true;
      this.cargarLedgerMensual();
    }
    if (!this.ledgerDiarioCargado || bancoCambio) {
      this.ledgerDiarioCargado = true;
      this.cargarLedgerDiario();
    }
    if (!this.antiguedadCargado || bancoCambio) {
      this.antiguedadCargado = true;
      this.cargarAntiguedad();
    }
  }

  /** Cambio del filtro "mes de origen" del ledger mensual (input nativo `type="month"`, mismo
   *  contrato que el del ledger diario). */
  onMesOrigenLedgerMensual(mesOrigen: string): void {
    this.ledgerMensualMesOrigen = mesOrigen;
    this.cargarLedgerMensual();
  }

  private cargarLedgerMensual(): void {
    this.ledgerMensualLoading = true;
    this.ledgerMensualError   = false;
    this.bankService.ledgerMensual(
      this.banco, this.ledgerMensualMesOrigen || null, this.LEDGER_MENSUAL_DESDE, null,
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

  /** 15 días — alimenta los charts/tabla de "Diario" y `hoyLedger`. */
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

  private cargarAntiguedad(): void {
    this.antiguedadLoading = true;
    this.antiguedadError   = false;
    this.bankService.antiguedadDepositos(this.banco)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          this.antiguedad       = res;
          this.antiguedadLoading = false;
          this.buildAntiguedadChart(res);
        },
        error: () => {
          this.antiguedadLoading = false;
          this.antiguedadError   = true;
        },
      });
  }

  /** Una sola barra por rango (el backend ya entrega los 4 buckets fijos) — mismo criterio de
   *  colores que el resto del panel: naranja (`#d9730d`) para llamar la atención sobre backlog
   *  que lleva más tiempo sin identificar, más intenso cuanto más viejo. Sin datalabels por
   *  barra (mismo criterio que "Corte mensual"/"Día actual": el detalle exacto vive en el
   *  tooltip y en las 4 tarjetas KPI, no impreso encima de la barra). */
  private buildAntiguedadChart(antiguedad: BankAntiguedadDepositos): void {
    const labels = antiguedad.rangos.map(r => r.rango);
    const colores = ['#5598e7', '#2a78d6', '#b5790a', '#d9730d'];
    this.antiguedadChartData = {
      labels,
      datasets: [{
        type: 'bar', label: 'Depósitos no identificados y vacíos', data: antiguedad.rangos.map(r => r.count),
        backgroundColor: colores,
        importes: antiguedad.rangos.map(r => r.saldo),
      }],
    };
  }

  /** Dataset "Saldo final" (el de arriba del apilado) con el datalabel de "al cierre" (suma de
   *  ambos segmentos) impreso encima de la barra — mismo dataset sirve para montos y para
   *  depósitos, `datos`/`alCierre`/`formatTotal` cambian según cuál. El datalabel se define a
   *  nivel de ESTE dataset (no en las opciones compartidas) porque solo el segmento de arriba
   *  lleva la cifra total — el de abajo ("Identificados en el periodo") no. */
  private datasetSaldoFinal(datos: number[], alCierre: number[], formatTotal: (v: number) => string | number, importes?: number[]): any {
    return {
      type: 'bar', label: 'Saldo final (no identificado)', data: datos, backgroundColor: '#d9730d', stack: 'x',
      ...(importes ? { importes } : {}),
      datalabels: {
        display: true, anchor: 'end', align: 'end', font: { size: 9, weight: 'bold' },
        formatter: (_: number, ctx: { dataIndex: number }) => formatTotal(alCierre[ctx.dataIndex]),
      },
    };
  }

  // 2 charts de "Corte mensual" (2026-11-06, mockup de referencia más establecido — reemplaza por
  // completo la grilla de 3 charts anterior): "Montos por mes"/"Número de depósitos por mes",
  // barra apilada identificados (abajo) + saldo final (arriba); el total de la barra ("al cierre"
  // = saldo inicial + nuevos) se imprime arriba (ver datasetSaldoFinal()). Mismo criterio de
  // colores que el resto del panel: azul = identificados/lectura neutra, naranja = lo que queda
  // sin identificar.
  private buildMensualCharts(ledger: BankLedgerMensual): void {
    const meses = ledger.meses;
    const labels = meses.map(m => this.formatMesCortoMensual(m.mes));
    const alCierreSaldo = meses.map(m => this.alCierre(m).saldo);
    const alCierreCount = meses.map(m => this.alCierre(m).count);

    this.montosPorMesChartData = {
      labels,
      datasets: [
        { type: 'bar', label: 'Identificados en el periodo', data: meses.map(m => m.identificados.saldo), backgroundColor: '#2a78d6', stack: 'x' },
        this.datasetSaldoFinal(meses.map(m => m.total.saldo), alCierreSaldo, v => this.formatImporteCompacto(v)),
      ],
    };

    this.movsPorMesChartData = {
      labels,
      datasets: [
        { type: 'bar', label: 'Identificados en el periodo', data: meses.map(m => m.identificados.count), backgroundColor: '#2a78d6', stack: 'x', importes: meses.map(m => m.identificados.saldo) },
        this.datasetSaldoFinal(meses.map(m => m.total.count), alCierreCount, v => v, meses.map(m => m.total.saldo)),
      ],
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

  /** "lunes 5 de octubre de 2026" — fecha completa con día de la semana y año, hora México
   *  explícita (el navegador del usuario puede correr en cualquier TZ). Usada por el encabezado
   *  único "Saldo por identificar al..." y "Resultado del [día]" (mockup de referencia,
   *  2026-11-06). */
  formatDiaLargo(fechaIso: string): string {
    return new Date(fechaIso).toLocaleDateString('es-MX', {
      timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  /** Saldo compacto (ej. "$452 mil", "$1.2 M") para los KPI del ledger mensual/diario —
   *  `Intl.NumberFormat` con `notation:'compact'` en es-MX, nunca abreviaturas en inglés (K/M)
   *  hardcodeadas a mano. */
  formatImporteCompacto(value: number): string {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1,
    }).format(value);
  }

  // 2 charts de "Diario" (mismo criterio que buildMensualCharts(), pero por día): "Montos por
  // día"/"Número de depósitos por día". Colores consistentes con "Mensual": azul `#2a78d6` =
  // identificados/lectura neutra, naranja `#d9730d` = lo que queda sin identificar.
  private buildDiarioChartsDeDias(ledger: BankLedgerDiario): void {
    const dias = ledger.dias;
    const labels = dias.map(d => this.formatFechaCorta(d.fecha));
    const alCierreSaldo = dias.map(d => this.alCierre(d).saldo);
    const alCierreCount = dias.map(d => this.alCierre(d).count);

    this.montosPorDiaChartData = {
      labels,
      datasets: [
        { type: 'bar', label: 'Identificados en el periodo', data: dias.map(d => d.identificados.saldo), backgroundColor: '#2a78d6', stack: 'x' },
        this.datasetSaldoFinal(dias.map(d => d.total.saldo), alCierreSaldo, v => this.formatImporteCompacto(v)),
      ],
    };

    this.movsPorDiaChartData = {
      labels,
      datasets: [
        { type: 'bar', label: 'Identificados en el periodo', data: dias.map(d => d.identificados.count), backgroundColor: '#2a78d6', stack: 'x', importes: dias.map(d => d.identificados.saldo) },
        this.datasetSaldoFinal(dias.map(d => d.total.count), alCierreCount, v => v, dias.map(d => d.total.saldo)),
      ],
    };
  }

  /** "17/10" — fecha corta sin año, labels de los charts "por día" de "Diario" (no mira tan
   *  atrás como para necesitar el año). */
  private formatFechaCorta(fechaIso: string): string {
    return new Date(fechaIso).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short' });
  }

  /** Mismo formato que las columnas de monto de las tablas comparativas
   *  (`currency:'MXN':'symbol':'1.2-2'`) — acá vía Intl directo porque el tooltip de Chart.js
   *  corre fuera de un binding de plantilla, no hay forma de usar el pipe de Angular ahí. */
  private formatImporte(value: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }
}
