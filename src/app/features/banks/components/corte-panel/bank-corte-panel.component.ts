import { Component, Input, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Chart, ChartEvent } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import zoomPlugin from 'chartjs-plugin-zoom';
import { BankService } from '../../../../core/services/bank.service';
import { ToastService } from '../../../../core/services/toast.service';
import {
  BankLedgerBacklog, BankLedgerDiaItem, BankLedgerDiario, BankLedgerMensual,
  BankLedgerMesItem, BankAntiguedadDepositos, BankAntiguedadPorAnio, BankAntiguedadMes,
  BankAntiguedadRango, CorteDescarga,
} from '../../../../core/models/bank.model';

// Registrado una sola vez a nivel módulo — `provideCharts(withDefaultRegisterables())` en
// banks.module.ts registra los controladores base de Chart.js, pero datalabels/zoom son plugins
// aparte que no vienen incluidos ahí. `ChartDataLabels` por default dibuja el valor crudo en cada
// punto — cada chart de este componente lo desactiva explícitamente (`plugins.datalabels.
// display:false` o `datalabels:{display:false}` por dataset) salvo que necesite una etiqueta
// puntual. `zoomPlugin` (2026-11-06, pedido explícito del usuario: "permite la opción de hacer
// zoom en las gráficas") solo se activa explícitamente en las opciones de los charts con muchas
// categorías en el eje X (Mensual/Diario/Antigüedad-Año, ver buildMensualChartOptionsApiladas()/
// buildAntiguedadAnioChartOptions()) — el resto de los charts de este proyecto no lo declaran en
// sus `plugins.zoom`, así que quedan inertes (el plugin exige habilitación explícita por chart).
Chart.register(ChartDataLabels, zoomPlugin);

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
  // `no_identificado` pero ya no está "vacío".
  antiguedad: BankAntiguedadDepositos | null = null;
  antiguedadLoading = false;
  antiguedadError   = false;
  antiguedadChartData: any = { labels: [], datasets: [] };
  antiguedadChartOptions: any = this.buildMensualChartOptionsBasico();

  // Corte por Día/Año (2026-11-06, segunda ronda — el usuario revisó de nuevo el mockup de
  // referencia: "no se está considerando el corte por año... así nunca podré ver cómo se han ido
  // cerrando los meses y años de forma histórica"). 'dia' (default) es el corte de un día puntual
  // ya existente (`antiguedad` arriba, ahora con fecha elegible); 'anio' trae los 12 cortes de
  // fin de mes de un año (`antiguedadPorAnio` abajo) — ver
  // bank-indicadores.service.js#getAntiguedadDepositosPorAnio.
  antiguedadCortePor: 'dia' | 'anio' = 'dia';
  antiguedadFecha = ''; // 'YYYY-MM-DD', vacío = hoy
  antiguedadAnio  = ''; // 'YYYY', vacío = año en curso

  antiguedadPorAnio: BankAntiguedadPorAnio | null = null;
  antiguedadAnioLoading = false;
  antiguedadAnioError   = false;
  antiguedadAnioChartData: any = { labels: [], datasets: [] };
  antiguedadAnioChartOptions: any = this.buildAntiguedadAnioChartOptions();
  antiguedadAnioMesSeleccionado: string | null = null;

  /** Últimos 5 años (incluido el actual) — rango fijo, no derivado del dato más antiguo real (no
   *  hay endpoint para eso todavía; el backlog "vacío" de Antigüedad rara vez acumula años, así
   *  que un rango fijo alcanza de sobra para este selector). */
  get aniosDisponibles(): string[] {
    const actual = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => String(actual - i));
  }

  /** 'YYYY-MM-DD' de hoy (hora del navegador) — solo como tope del `<input type="date">` del
   *  modo "Día", no se usa para ningún cálculo de negocio (eso lo resuelve el backend en hora
   *  México). */
  get hoyStrInput(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Rangos/total a mostrar en las 4 tarjetas KPI — en modo 'anio', suma los 4 rangos de TODOS
   *  los meses ya cargados (mismo criterio que el mockup de referencia: el total anual es la
   *  suma de los cortes mensuales); en modo 'dia', el corte puntual de siempre. */
  get antiguedadKpis(): BankAntiguedadDepositos | null {
    if (this.antiguedadCortePor !== 'anio') return this.antiguedad;
    const meses = this.antiguedadPorAnio?.meses;
    if (!meses || !meses.length) return null;
    const rangos: BankAntiguedadRango[] = meses[0].rangos.map((r, i) => ({
      rango: r.rango,
      count: meses.reduce((s, m) => s + m.rangos[i].count, 0),
      saldo: meses.reduce((s, m) => s + m.rangos[i].saldo, 0),
    }));
    return {
      rangos,
      total: {
        count: rangos.reduce((s, r) => s + r.count, 0),
        saldo: rangos.reduce((s, r) => s + r.saldo, 0),
      },
    };
  }

  /** Mes elegido (click en el chart anual) o, por default, el más reciente — mismo criterio que
   *  `mesResultado`/`diaResultado`. Alimenta el desglose "Resultado de [mes]" del modo "Año". */
  get antiguedadAnioResultado(): BankAntiguedadMes | null {
    const meses = this.antiguedadPorAnio?.meses;
    if (!meses || !meses.length) return null;
    return meses.find(m => m.periodo === this.antiguedadAnioMesSeleccionado) ?? meses[meses.length - 1];
  }

  seleccionarAntiguedadAnioMes(periodo: string): void { this.antiguedadAnioMesSeleccionado = periodo; }

  /** Mismo criterio que `onClickMesChart()`/`onClickDiaChart()`. */
  onClickAntiguedadAnioChart(event: { event?: ChartEvent; active?: object[] }): void {
    const idx = (event?.active?.[0] as { index?: number } | undefined)?.index;
    const periodo = idx != null ? this.antiguedadPorAnio?.meses[idx]?.periodo : null;
    if (periodo) this.seleccionarAntiguedadAnioMes(periodo);
  }

  // Exportar + historial de descargas (2026-11-06, pedido explícito del usuario: un solo botón
  // para TODO Cortes — no uno por tab, exporta siempre Mensual/Diario/Antigüedad juntas — y un
  // solo historial compartido, visible sin importar qué tab esté activo). `descargasCorte` viene
  // más reciente primero, con el delta ya calculado del lado del backend (ver
  // bank-indicadores.service.js#listarDescargasCorte) — acá solo se formatea para mostrar.
  //
  // CORRECCIÓN DE UI (2026-11-06, segunda ronda — el usuario reportó que el historial, renderizado
  // inline arriba del todo, empujaba el toggle Mensual/Diario/Antigüedad y sus gráficas hacia
  // abajo): pasa a vivir en un `<app-modal>` (`descargasModalAbierto`), cerrado por default y
  // cargado recién al abrirlo — ya no ocupa espacio del flujo normal de la página.
  descargando = false;
  descargasModalAbierto = false;
  descargasCorte: CorteDescarga[] | null = null;
  descargasCorteLoading = false;
  descargasCorteError   = false;
  descargandoHistoricoId: string | null = null;

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

  /** Zoom (rueda/pinch) + pan (arrastre) en el eje X, compartido por los 3 charts con muchas
   *  categorías (Mensual/Diario/Antigüedad-Año — 2026-11-06, pedido explícito del usuario). El eje
   *  Y nunca se zoomea/paneá (`mode:'x'` en los 3 bloques): estos charts son barras apiladas, un
   *  zoom en Y rompería la lectura de "altura = total" que ya usan los datalabels. `resetZoom()` se
   *  dispara desde un botón explícito (ver `resetZoom()` más abajo) vía `Chart.getChart(canvas)` —
   *  no depende de la API interna de `ng2-charts`, así que es estable entre versiones de esa
   *  librería. */
  private buildZoomPluginOptions(): any {
    return {
      pan:  { enabled: true, mode: 'x' as const },
      zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' as const },
    };
  }

  /** Mismas opciones que el básico, pero con los 2 ejes apilados — para los 4 charts de
   *  "Montos"/"Número de depósitos" por mes/día (2 segmentos: identificados / saldo final). */
  private buildMensualChartOptionsApiladas(): any {
    const base = this.buildMensualChartOptionsBasico();
    return {
      ...base,
      scales: { x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true } },
      plugins: { ...base.plugins, zoom: this.buildZoomPluginOptions() },
    };
  }

  /** `Chart.getChart(canvas)` resuelve la instancia real de Chart.js adjunta a ese `<canvas>` —
   *  no requiere ninguna referencia de `ng2-charts`, así que funciona igual para cualquier chart
   *  de este componente con solo pasarle su `#ref` de plantilla. Varios canvases a la vez (ej. los
   *  2 de "Mensual") comparten un solo botón "Restablecer zoom". */
  resetZoom(...canvases: (HTMLCanvasElement | undefined)[]): void {
    for (const canvas of canvases) {
      if (canvas) (Chart.getChart(canvas) as any)?.resetZoom?.();
    }
  }

  /** Mismas opciones apiladas de arriba, más un filtro de tooltip para que el dataset-bandera
   *  "Mes resuelto" (ver `buildAntiguedadAnioChart`) no aparezca como "Mes resuelto: 0" en los
   *  meses que SÍ tienen backlog real — solo se muestra cuando realmente vale algo (meses
   *  resueltos). */
  private buildAntiguedadAnioChartOptions(): any {
    const base = this.buildMensualChartOptionsApiladas();
    return {
      ...base,
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins.tooltip,
          filter: (item: any) => !(item.dataset.label === 'Mes resuelto' && item.raw === 0),
        },
      },
    };
  }

  private destroy$ = new Subject<void>();

  constructor(private bankService: BankService, private toast: ToastService) {}

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
  private antiguedadAnioCargado = false;
  private descargasCorteCargado = false;

  /** Dispara el fetch — llamado por el carousel (padre) al activar/recargar este slide.
   *  `descargasCorte` (historial) ya NO se carga acá (2026-11-06, segunda ronda) — vive en un
   *  modal cerrado por default, se pide recién al abrirlo (ver abrirHistorialDescargas()); si
   *  cambia el banco mientras el modal está abierto, se refresca igual. */
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
    if (bancoCambio) {
      this.antiguedadCargado = false;
      this.antiguedadAnioCargado = false;
    }
    if (this.antiguedadCortePor === 'dia') {
      if (!this.antiguedadCargado || bancoCambio) {
        this.antiguedadCargado = true;
        this.cargarAntiguedad();
      }
    } else if (!this.antiguedadAnioCargado || bancoCambio) {
      this.antiguedadAnioCargado = true;
      this.cargarAntiguedadPorAnio();
    }
    if (bancoCambio) {
      this.descargasCorteCargado = false;
      if (this.descargasModalAbierto) {
        this.descargasCorteCargado = true;
        this.cargarDescargasCorte();
      }
    }
  }

  /** Abre el modal de historial de descargas — lo carga la primera vez que se abre (lazy, mismo
   *  criterio ya usado para el resto de esta pantalla: no pedir datos que el usuario no va a
   *  ver). */
  abrirHistorialDescargas(): void {
    this.descargasModalAbierto = true;
    if (!this.descargasCorteCargado) {
      this.descargasCorteCargado = true;
      this.cargarDescargasCorte();
    }
  }

  cerrarHistorialDescargas(): void {
    this.descargasModalAbierto = false;
  }

  /** Toggle "Corte por: Día / Año" del tab Antigüedad (2026-11-06, segunda ronda) — carga el modo
   *  recién al activarlo por primera vez (lazy). */
  cambiarAntiguedadCortePor(tipo: 'dia' | 'anio'): void {
    this.antiguedadCortePor = tipo;
    if (tipo === 'dia' && !this.antiguedadCargado) {
      this.antiguedadCargado = true;
      this.cargarAntiguedad();
    } else if (tipo === 'anio' && !this.antiguedadAnioCargado) {
      this.antiguedadAnioCargado = true;
      this.cargarAntiguedadPorAnio();
    }
  }

  onCambioAntiguedadFecha(fecha: string): void {
    this.antiguedadFecha = fecha;
    this.cargarAntiguedad();
  }

  onCambioAntiguedadAnio(anio: string): void {
    this.antiguedadAnio = anio;
    this.antiguedadAnioMesSeleccionado = null;
    this.cargarAntiguedadPorAnio();
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
    this.bankService.antiguedadDepositos(this.banco, this.antiguedadFecha || null)
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

  private cargarAntiguedadPorAnio(): void {
    const anio = this.antiguedadAnio || String(new Date().getFullYear());
    this.antiguedadAnioLoading = true;
    this.antiguedadAnioError   = false;
    this.bankService.antiguedadDepositosPorAnio(this.banco, anio)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          this.antiguedadPorAnio   = res;
          this.antiguedadAnioLoading = false;
          this.buildAntiguedadAnioChart(res);
        },
        error: () => {
          this.antiguedadAnioLoading = false;
          this.antiguedadAnioError   = true;
        },
      });
  }

  private cargarDescargasCorte(): void {
    this.descargasCorteLoading = true;
    this.descargasCorteError   = false;
    this.bankService.descargasCorte(this.banco)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          this.descargasCorte       = res;
          this.descargasCorteLoading = false;
        },
        error: () => {
          this.descargasCorteLoading = false;
          this.descargasCorteError   = true;
        },
      });
  }

  /** Mismo patrón que descargarBlob() en bank-cobranza-panel.component.ts/
   *  bank-indicadores-panel.component.ts: blob -> URL.createObjectURL -> click en <a> temporal
   *  -> revoke. Copia local a propósito (mismo criterio que esos 2 paneles) — no amerita
   *  extraerlo a un servicio compartido por un tercer uso. */
  private descargarBlob(fetch$: Observable<Blob>, nombreArchivo: string): void {
    if (this.descargando) return;
    this.descargando = true;
    fetch$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = nombreArchivo;
        a.click();
        URL.revokeObjectURL(url);
        this.descargando = false;
        // Refresca el historial para que la descarga recién hecha aparezca sin recargar la
        // página — el backend ya dejó su registro antes de responder el Excel.
        this.cargarDescargasCorte();
      },
      error: () => {
        this.descargando = false;
        this.toast.error('No se pudo generar el Excel de Cortes.');
      },
    });
  }

  /** Exporta las 3 vistas de Cortes (Mensual/Diario/Antigüedad) en un solo Excel — un único
   *  botón para todo el panel, independiente de `vistaActiva` (2026-11-06, pedido explícito del
   *  usuario). */
  descargarCortes(): void {
    const fecha = new Date().toISOString().slice(0, 10);
    this.descargarBlob(this.bankService.descargarCortes(this.banco), `Cortes-${fecha}.xlsx`);
  }

  /** Vuelve a bajar el archivo real de una fila del historial (2026-11-06, segunda ronda — antes
   *  el historial solo mostraba el delta de backlog, no permitía recuperar el Excel de un punto
   *  pasado). No reusa `descargarBlob()` (ese método gatea TODO con el flag `descargando`
   *  compartido con "Exportar" y siempre refresca el historial al terminar — acá cada fila
   *  necesita su PROPIO indicador de "generando", y no hace falta refrescar nada). */
  descargarHistorico(d: CorteDescarga): void {
    if (!d.driveFileId || this.descargandoHistoricoId) return;
    this.descargandoHistoricoId = d._id;
    this.bankService.descargarReporteCorteHistorico(d._id)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a   = document.createElement('a');
          a.href     = url;
          a.download = `Cortes-${d.fecha.slice(0, 10)}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
          this.descargandoHistoricoId = null;
        },
        error: () => {
          this.descargandoHistoricoId = null;
          this.toast.error('No se pudo recuperar el archivo de esa descarga.');
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

  /** Modo "Año" (2026-11-06, CUARTA ronda — vuelve a agrupar por MES DE ORIGEN del depósito en vez
   *  de un corte histórico de fin de mes, ver docstring de `getAntiguedadDepositosPorAnio` en el
   *  backend): una barra apilada por mes, un segmento por rango de antigüedad — mismos 4 colores
   *  que el chart de "Día" de arriba, para que ambos modos se lean como el mismo lenguaje visual.
   *  El detalle exacto de cada mes vive en el tooltip (reusa el callback ya compartido por
   *  `buildMensualChartOptionsBasico()`, que lee `dataset.importes`) y en el panel "Resultado de
   *  [mes]" de abajo (click en una barra, ver onClickAntiguedadAnioChart).
   *
   *  "Mes resuelto" (pedido explícito del usuario: "poder ver qué meses ya están sin depósitos no
   *  identificados"): ya NO es un dataset con una cantidad (`resuelto` se quitó del contrato del
   *  backend — generaba números confusos, ver corrección de esta misma ronda) — es una señal
   *  binaria. Un mes con `total.count === 0` no tiene nada que apilar, así que se agrega una barra
   *  "bandera" de altura fija y chica (`ALTURA_BANDERA_RESUELTO`, independiente de cualquier
   *  magnitud real) en el mismo verde `#1a9c5b` ya usado en este componente para "bajó/bueno"
   *  (`.corte-delta--bajo`), con un datalabel "✓ Resuelto" para que nunca se confunda con una
   *  cantidad real. Meses con backlog real no reciben esta barra (queda en 0, invisible). */
  private buildAntiguedadAnioChart(data: BankAntiguedadPorAnio): void {
    const meses = data.meses;
    const labels = meses.map(m => this.formatMesCortoMensual(m.periodo));
    const colores = ['#5598e7', '#2a78d6', '#b5790a', '#d9730d'];
    const verdeResuelto = '#1a9c5b';
    const nRangos = meses[0]?.rangos.length ?? 0;

    const maxTotal = Math.max(1, ...meses.map(m => m.total.count));
    const ALTURA_BANDERA_RESUELTO = Math.max(1, Math.round(maxTotal * 0.06));

    const datasets: any[] = [];
    for (let i = 0; i < nRangos; i++) {
      datasets.push({
        type: 'bar',
        label: meses[0].rangos[i].rango,
        data: meses.map(m => m.rangos[i].count),
        backgroundColor: colores[i],
        stack: 'x',
        importes: meses.map(m => m.rangos[i].saldo),
      });
    }
    datasets.push({
      type: 'bar',
      label: 'Mes resuelto',
      data: meses.map(m => (m.total.count === 0 ? ALTURA_BANDERA_RESUELTO : 0)),
      backgroundColor: verdeResuelto,
      stack: 'x',
      // Bandera visual, no una cantidad real — el tooltip no debe mostrar un "importe" inventado.
      importes: meses.map(() => null),
      datalabels: {
        display: (ctx: { dataIndex: number }) => meses[ctx.dataIndex].total.count === 0,
        anchor: 'end', align: 'end', color: verdeResuelto, font: { size: 9, weight: 'bold' },
        formatter: () => '✓ Resuelto',
      },
    });
    this.antiguedadAnioChartData = { labels, datasets };
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

  /** "6 nov 26, 14:32" — fecha corta + hora, hora México explícita. Usada por el historial de
   *  descargas (2026-11-06): a diferencia de `formatDiaLargo()`, acá SÍ importa la hora exacta
   *  (puede haber más de una descarga el mismo día). */
  formatFechaHora(fechaIso: string): string {
    return new Date(fechaIso).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
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
