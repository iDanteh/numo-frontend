import { Component, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import { catchError, map, switchMap, takeUntil } from 'rxjs/operators';
import { Chart } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { BaseChartDirective } from 'ng2-charts';
import { BankService } from '../../../../core/services/bank.service';
import { BankCorteConciliacion, BankCorteTendencia, BankCorteTendenciaPunto } from '../../../../core/models/bank.model';
import { ToastService } from '../../../../core/services/toast.service';
import { SocketService } from '../../../../core/services/socket.service';

// Registrado una sola vez a nivel módulo (2026-10-22, pedido explícito del usuario: zoom/pan
// en el gráfico de tendencia) — `provideCharts(withDefaultRegisterables())` en banks.module.ts
// registra los controladores base de Chart.js, pero chartjs-plugin-zoom es un plugin aparte
// que no viene incluido ahí.
Chart.register(zoomPlugin);

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
  puedeAlternarPeriodo = false;
  descargandoReporte = false;

  // Corte histórico personalizado (2026-10-06, pedido explícito del usuario): ambos null =
  // modo tiempo real de siempre (periodo EN CURSO). Ambos vienen juntos o ninguno — ver
  // seleccionarFechaHistorica()/volverATiempoReal().
  fechaInicioCustom: string | null = null;
  fechaFinCustom:    string | null = null;

  // Tendencia histórica del backlog (2026-10-22, pedido explícito del usuario) — gráfico mixto
  // barras + línea de tendencia (ver buildTendenciaChart()), aparte e independiente de la carga
  // principal (si falla, el resto del panel igual se muestra; ver cargarTendencia()). Mismo
  // patrón chart.js/ng2-charts que system-monitor y dashboard (chartData genérico, sin tipar —
  // mismo criterio ya usado ahí).
  tendencia: BankCorteTendencia | null = null;
  tendenciaLoading = false;
  tendenciaError   = false;
  tendenciaChartData: any = { labels: [], datasets: [] };

  // Zoom/pan (2026-10-22, pedido explícito del usuario): con "Ver por estatus" ON (5 barras +
  // 5 líneas desglosadas), algunos periodos no se logran leer bien con todos los puntos a la
  // vez. Rueda/pinch hacen zoom, drag hace pan, ambos solo en modo desglosado — en modo
  // agregado (2 barras) no hace falta y lo dejamos sin plugin activo para no interferir con el
  // comportamiento default del chart. NO es `readonly`: se recalcula en toggleVerPorEstatus()
  // en vez de un getter, para no generar un objeto nuevo en cada ciclo de change detection
  // (eso dispararía updates innecesarios del chart vía ng2-charts).
  @ViewChild(BaseChartDirective) private tendenciaChartDirective?: BaseChartDirective;
  tendenciaChartOptions: any = this.buildTendenciaChartOptions();

  // CxC retrasadas (2026-10-22, 2da revisión): el detalle vive en un modal (`<app-modal>`,
  // shared/components/modal — mismo componente reutilizable que ya usan lealtad y
  // collection-requests) en vez de expandir inline. Antes expandía dentro del dashboard, pero
  // eso generaba el mismo tipo de salto de layout que ya se resolvió para el refresh de
  // filtros — el usuario pidió explícitamente moverlo a un contenedor aparte.
  cxcRetrasadasModalOpen = false;

  // Switch "Ver por estatus" (2026-10-22, pedido explícito del usuario) — con el switch OFF,
  // el gráfico de tendencia muestra 2 barras agregadas (iniciales/nuevos, como siempre). Con
  // el switch ON, se desglosan en 5: iniciales·no_identificado, iniciales·reclasificado,
  // nuevos·no_identificado, nuevos·reclasificado, y nuevos·identificado (esta última SOLO en
  // "nuevos" — decisión confirmada con el usuario vía AskUserQuestion: permite ver de un
  // vistazo qué fracción de lo que llegó en el periodo ya se resolvió, sin un bucket
  // equivalente para "iniciales" que nadie pidió). Reconstruye el chart sobre los mismos
  // datos ya cargados (this.tendencia) — no dispara una nueva carga al backend.
  verPorEstatus = false;

  toggleVerPorEstatus(): void {
    this.verPorEstatus = !this.verPorEstatus;
    // Resetear ANTES de cambiar options: si había un zoom/pan aplicado en modo desglosado, no
    // debe arrastrarse al volver a modo agregado (donde el plugin ya ni siquiera está activo).
    this.tendenciaChartDirective?.chart?.resetZoom();
    this.tendenciaChartOptions = this.buildTendenciaChartOptions();
    if (this.tendencia) this.buildTendenciaChart(this.tendencia);
  }

  /** Restablece el zoom/pan del chart de tendencia — botón visible solo en modo "Ver por
   *  estatus" (ver bank-corte-panel.component.html). */
  resetZoomTendencia(): void {
    this.tendenciaChartDirective?.chart?.resetZoom();
  }

  private buildTendenciaChartOptions(): any {
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
        // Importe por barra en el tooltip (2026-10-22, pedido explícito del usuario): cada
        // dataset de barra lleva un array paralelo `importes` (ver barraTendencia()) con la
        // suma real de `deposito` de ese punto — no es una métrica nueva, es el mismo
        // `importeTotal` que ya expone el backend, solo adjunto al dataset para que el
        // callback lo lea por índice. Los datasets de línea no lo llevan: comparten el mismo
        // punto que su barra, mostrar el importe ahí también sería un duplicado sin aportar.
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const base = `${ctx.dataset.label}: ${ctx.formattedValue}`;
              const importe = ctx.dataset.importes?.[ctx.dataIndex];
              return importe == null ? base : `${base} (${this.formatImporte(importe)})`;
            },
          },
        },
        ...(this.verPorEstatus ? {
          zoom: {
            pan:  { enabled: true, mode: 'x' as const },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' as const },
          },
        } : {}),
      },
    };
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
                this.periodoActivo      = res.periodo;
                this.puedeAlternarPeriodo = res.puedeAlternar;
                this.periodoRolCargado   = true;
              }),
            );
        return periodoRol$.pipe(
          switchMap(() => this.bankService.corteConciliacion(
            this.periodoActivo, this.banco, this.fechaInicioCustom, this.fechaFinCustom,
          )),
          catchError(() => { this.error = true; return of(null); }),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe(res => {
      this.loading = false;
      if (res) {
        this.data = res;
        // Independiente de `data` a propósito: si la tendencia falla, el resto del panel
        // (hero/desglose/CxC retrasadas) igual se muestra con lo que ya cargó arriba.
        this.cargarTendencia();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Dispara el fetch — llamado por el carousel (padre) al activar/recargar este slide. */
  load(banco?: string | null): void {
    if (banco !== undefined) this.banco = banco;
    this.loadTrigger$.next();
  }

  cambiarPeriodo(periodo: CortePeriodo): void {
    if (periodo === this.periodoActivo || !this.puedeAlternarPeriodo) return;
    this.periodoActivo = periodo;
    // Un rango histórico elegido en una granularidad (semana/mes) no tiene sentido en la
    // otra — que el usuario vuelva a elegir en la nueva granularidad en vez de arrastrar un
    // rango que ya no corresponde.
    this.fechaInicioCustom = null;
    this.fechaFinCustom    = null;
    this.loadTrigger$.next();
  }

  /** Dispara la carga de un corte histórico personalizado — el usuario hace click en
   *  CUALQUIER día de la semana/mes que quiere ver (vía app-date-range-popover en modo
   *  singleDayOnly), y se "ajusta" ese click al rango completo del periodo correspondiente. */
  seleccionarFechaHistorica(iso: string): void {
    const { fechaInicio, fechaFin } = this.snapAPeriodo(iso);
    this.fechaInicioCustom = fechaInicio;
    this.fechaFinCustom    = fechaFin;
    this.loadTrigger$.next();
  }

  /** Vuelve al modo tiempo real (periodo EN CURSO) — limpia el rango histórico custom. */
  volverATiempoReal(): void {
    this.fechaInicioCustom = null;
    this.fechaFinCustom    = null;
    this.loadTrigger$.next();
  }

  abrirCxcRetrasadasModal(): void {
    this.cxcRetrasadasModalOpen = true;
  }

  cerrarCxcRetrasadasModal(): void {
    this.cxcRetrasadasModalOpen = false;
  }

  /** "26 de septiembre" — mismo criterio de timeZone explícito que formatInicio() (el punto de
   *  la serie viaja como instante UTC real de medianoche México). */
  formatPuntoTendencia(punto: BankCorteTendenciaPunto): string {
    const d = new Date(punto.inicio);
    return d.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short' });
  }

  /** "septiembre 2026" a partir de un "YYYY-MM" (mesFolio de una CxC retrasada). */
  formatMesFolio(mesFolio: string): string {
    const [anio, mes] = mesFolio.split('-').map(Number);
    return new Date(anio, mes - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  }

  private cargarTendencia(): void {
    this.tendenciaLoading = true;
    this.tendenciaError   = false;
    this.bankService.tendenciaCorte(this.periodoActivo, this.banco).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.tendencia       = res;
        this.tendenciaLoading = false;
        this.buildTendenciaChart(res);
      },
      error: () => {
        this.tendenciaLoading = false;
        this.tendenciaError   = true;
      },
    });
  }

  // Mixed chart (2026-10-22, pedido explícito del usuario: barras con una línea de tendencia
  // superpuesta, en vez de solo línea) — Chart.js permite mezclar tipos por dataset dentro de
  // un mismo `data.datasets`; acá cada serie se dibuja 2 veces, una como barra (el valor real
  // del periodo) y otra como línea (los MISMOS valores, solo conectados para que la dirección
  // se vea de un vistazo — no es una métrica nueva de tendencia suavizada). El orden del array
  // (barras primero, líneas después) ya alcanza para que Chart.js dibuje las líneas encima.
  //
  // Switch "Ver por estatus" (ver `verPorEstatus` arriba): agregado (2 barras) vs. desglosado
  // (5 barras). La paleta original agrupaba por FAMILIA de color (ámbar = iniciales, índigo =
  // nuevos, con tintes claro/oscuro para no_identificado/reclasificado dentro de cada familia),
  // pero el usuario reportó que no_identificado y reclasificado se veían demasiado parecidos
  // (2026-10-22) — validado con el validador de paletas: la separación de esos tintes estaba
  // por debajo del piso de visión normal (ΔE ~12-13, piso exigido >=15). Usar tintes claro/
  // oscuro del MISMO hue no alcanza la distinción necesaria, así que ahora cada una de las 5
  // barras usa un hue categórico distinto y bien separado (azul/naranja/aqua/amarillo +
  // verde = identificado, igual que .corte-hero-stat--identificados, sin tocar). La familia
  // (iniciales/nuevos) se sigue leyendo por el texto del label en leyenda y tooltip, no por el
  // color. Las líneas del modo desglosado son más finas y sin puntos (pointRadius 0) a
  // propósito — con 5 series superpuestas, líneas iguales a las del modo agregado dejarían el
  // gráfico ilegible.
  private buildTendenciaChart(tendencia: BankCorteTendencia): void {
    const labels = tendencia.puntos.map(p => this.formatPuntoTendencia(p));

    if (!this.verPorEstatus) {
      const rezagados = tendencia.puntos.map(p => p.rezagadosTotal);
      const nuevos     = tendencia.puntos.map(p => p.nuevosPendientes);
      const rezagadosImporte = tendencia.puntos.map(p => p.rezagadosTotalImporte);
      const nuevosImporte     = tendencia.puntos.map(p => p.nuevosPendientesImporte);
      this.tendenciaChartData = {
        labels,
        datasets: [
          this.barraTendencia('Depósitos no identificados iniciales', rezagados, '#b5790a', 'rgba(181,121,10,.35)', rezagadosImporte),
          this.barraTendencia('Nuevos depósitos no identificados', nuevos, '#6a72e0', 'rgba(106,114,224,.35)', nuevosImporte),
          // Visible por defecto SOLO "no identificados iniciales" (2026-10-22, pedido explícito
          // del usuario) — el resto de líneas de Tendencia arrancan ocultas (clickeable desde la
          // leyenda) para no saturar el chart; las barras no se tocan, siguen siempre visibles.
          this.lineaTendencia('Tendencia — no identificados iniciales', rezagados, '#b5790a'),
          this.lineaTendencia('Tendencia — nuevos', nuevos, '#6a72e0', false, true),
        ],
      };
      return;
    }

    const rezNoIdent = tendencia.puntos.map(p => p.rezagadosNoIdentificado);
    const rezReclas  = tendencia.puntos.map(p => p.rezagadosReclasificado);
    const nueNoIdent = tendencia.puntos.map(p => p.nuevosNoIdentificado);
    const nueReclas  = tendencia.puntos.map(p => p.nuevosReclasificado);
    const nueIdent   = tendencia.puntos.map(p => p.nuevosIdentificado);

    const rezNoIdentImporte = tendencia.puntos.map(p => p.rezagadosNoIdentificadoImporte);
    const rezReclasImporte  = tendencia.puntos.map(p => p.rezagadosReclasificadoImporte);
    const nueNoIdentImporte = tendencia.puntos.map(p => p.nuevosNoIdentificadoImporte);
    const nueReclasImporte  = tendencia.puntos.map(p => p.nuevosReclasificadoImporte);
    const nueIdentImporte   = tendencia.puntos.map(p => p.nuevosIdentificadoImporte);

    const barras = [
      this.barraTendencia('Iniciales · No identificado', rezNoIdent, '#2a78d6', 'rgba(42,120,214,.55)', rezNoIdentImporte),
      this.barraTendencia('Iniciales · Por conciliar',    rezReclas,  '#eb6834', 'rgba(235,104,52,.45)', rezReclasImporte),
      this.barraTendencia('Nuevos · No identificado',     nueNoIdent, '#1baf7a', 'rgba(27,175,122,.55)', nueNoIdentImporte),
      this.barraTendencia('Nuevos · Por conciliar',       nueReclas,  '#eda100', 'rgba(237,161,0,.45)', nueReclasImporte),
      this.barraTendencia('Nuevos · Identificado',        nueIdent,   '#0e9c6f', 'rgba(14,156,111,.4)', nueIdentImporte),
    ];
    // Visible por defecto SOLO "iniciales · no identificado" — las otras 4 líneas de Tendencia
    // arrancan ocultas (togglebles desde la leyenda); las 5 barras no se tocan.
    const lineas = [
      this.lineaTendencia('Tendencia — iniciales · no identificado', rezNoIdent, '#2a78d6', true, false),
      this.lineaTendencia('Tendencia — iniciales · por conciliar',   rezReclas,  '#eb6834', true, true),
      this.lineaTendencia('Tendencia — nuevos · no identificado',    nueNoIdent, '#1baf7a', true, true),
      this.lineaTendencia('Tendencia — nuevos · por conciliar',      nueReclas,  '#eda100', true, true),
      this.lineaTendencia('Tendencia — nuevos · identificado',       nueIdent,   '#0e9c6f', true, true),
    ];
    this.tendenciaChartData = { labels, datasets: [...barras, ...lineas] };
  }

  private barraTendencia(label: string, data: number[], borderColor: string, backgroundColor: string, importes?: number[]) {
    return { type: 'bar', label, data, backgroundColor, borderColor, borderWidth: 1, importes };
  }

  /** Mismo formato que la columna "Importe" de CxC retrasadas (`currency:'MXN':'symbol':'1.2-2'`)
   *  — acá vía Intl directo porque el tooltip de Chart.js corre fuera de un binding de plantilla,
   *  no hay forma de usar el pipe de Angular ahí. */
  private formatImporte(value: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }

  /** `sutil`: variante del modo desglosado (5 series) — línea más fina y sin puntos, para no
   *  saturar el gráfico cuando hay 5 series superpuestas (ver buildTendenciaChart arriba).
   *  `hiddenPorDefecto`: arranca oculta del chart (clickeable desde la leyenda para mostrarla) —
   *  ver comentario en buildTendenciaChart sobre qué línea queda visible por defecto. */
  private lineaTendencia(label: string, data: number[], borderColor: string, sutil = false, hiddenPorDefecto = false) {
    return {
      type: 'line',
      label,
      data,
      borderColor,
      backgroundColor: 'transparent',
      borderDash: [4, 3],
      fill: false,
      tension: .25,
      borderWidth: sutil ? 1 : 2,
      pointRadius: sutil ? 0 : 2,
      hidden: hiddenPorDefecto,
    };
  }

  // Ajusta el día clickeado al rango completo semanal (lunes-domingo) o mensual (día 1-último),
  // MISMA convención de lunes que _inicioSemanaMexico() en bank-indicadores.service.js (backend).
  // Trabaja en fecha LOCAL del navegador (solo para computar qué semana/mes eligió el usuario al
  // hacer click en el calendario, no para el cálculo real del corte — eso lo hace el backend con
  // su propio offset fijo de México).
  private snapAPeriodo(iso: string): { fechaInicio: string; fechaFin: string } {
    const d = new Date(iso + 'T12:00:00');
    if (this.periodoActivo === 'mensual') {
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const last  = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { fechaInicio: this.toIso(first), fechaFin: this.toIso(last) };
    }
    const dow = d.getDay(); // 0=domingo..6=sábado
    const diasDesdeLunes = dow === 0 ? 6 : dow - 1;
    const lunes   = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diasDesdeLunes);
    const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
    return { fechaInicio: this.toIso(lunes), fechaFin: this.toIso(domingo) };
  }

  private toIso(d: Date): string {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

  /** Análogo a formatInicio() para el cierre del corte histórico (`data.fin`). */
  formatFin(finIso: string): string {
    const d = new Date(finIso);
    return d.toLocaleDateString('es-MX', {
      timeZone: 'America/Mexico_City',
      day: 'numeric', month: 'long',
      weekday: this.periodoActivo === 'semanal' ? 'long' : undefined,
    });
  }

  /** Mismo patrón que descargarBlob() en bank-cobranza-panel.component.ts: blob ->
   *  URL.createObjectURL -> click en <a> temporal -> revoke. */
  descargarReporte(): void {
    if (this.descargandoReporte) return;
    this.descargandoReporte = true;
    const fecha = new Date().toISOString().slice(0, 10);
    this.bankService.reporteCorte(
      this.periodoActivo, this.banco, this.fechaInicioCustom, this.fechaFinCustom,
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
