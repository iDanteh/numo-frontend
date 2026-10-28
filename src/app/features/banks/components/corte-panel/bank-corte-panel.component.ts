import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import { catchError, map, switchMap, takeUntil } from 'rxjs/operators';
import { Chart } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { BankService } from '../../../../core/services/bank.service';
import { BankCorteConciliacion, BankCorteAntiguedad, BankCorteAntiguedadBucket } from '../../../../core/models/bank.model';
import { ToastService } from '../../../../core/services/toast.service';
import { SocketService } from '../../../../core/services/socket.service';

// Registrado una sola vez a nivel módulo — `provideCharts(withDefaultRegisterables())` en
// banks.module.ts registra los controladores base de Chart.js, pero datalabels (barras
// apiladas con etiquetas por segmento/total — ver buildAntiguedadChart()) es un plugin
// aparte que no viene incluido ahí. El plugin de zoom/pan (chartjs-plugin-zoom) que usaba el
// chart de Tendencia ya NO hace falta: el chart de Antigüedad (2026-10-28, lo reemplaza por
// completo, ampliado a 5 buckets el mismo día — ver ORDEN_BUCKETS) son solo barras fijas, sin
// necesidad de zoom/pan.
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

  // Antigüedad del backlog ACTUAL (2026-10-28, reemplaza por completo el chart de "Tendencia
  // del backlog" — ya no es una serie corte a corte, es un desglose de antigüedad "hoy hacia
  // atrás"), aparte e independiente de la carga principal (si falla, el resto del panel igual
  // se muestra; ver cargarAntiguedad()). Independiente también de `periodoActivo` — solo depende
  // de `banco`, ver load(). Mismo patrón chart.js/ng2-charts que system-monitor y dashboard
  // (chartData genérico, sin tipar — mismo criterio ya usado ahí).
  antiguedad: BankCorteAntiguedad | null = null;
  antiguedadLoading = false;
  antiguedadError   = false;
  antiguedadChartData: any = { labels: [], datasets: [] };
  antiguedadChartOptions: any = this.buildAntiguedadChartOptions();

  // CxC retrasadas (2026-10-22, 2da revisión): el detalle vive en un modal (`<app-modal>`,
  // shared/components/modal — mismo componente reutilizable que ya usan lealtad y
  // collection-requests) en vez de expandir inline. Antes expandía dentro del dashboard, pero
  // eso generaba el mismo tipo de salto de layout que ya se resolvió para el refresh de
  // filtros — el usuario pidió explícitamente moverlo a un contenedor aparte.
  cxcRetrasadasModalOpen = false;

  private buildAntiguedadChartOptions(): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      // Padding arriba: el label de TOTAL (ver barraAntiguedad()) se dibuja fuera del área de
      // la barra, `anchor:'end', align:'top'` — sin aire extra encima del punto más alto,
      // Chart.js lo recorta contra el borde del canvas en vez de agrandar el contenedor en CSS.
      layout: { padding: { top: 20 } },
      scales: {
        // Apiladas (mismo mecanismo ya usado en el chart anterior de Tendencia): cada bucket
        // de antigüedad apila sus 3 segmentos (iniciales/nuevos/identificados) para leer el
        // TOTAL del bucket de un vistazo (ver datalabel de total en la barra superior del
        // stack) sin perder el desglose por segmento.
        x: { stacked: true, ticks: { font: { size: 10 } }, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { font: { size: 10 }, precision: 0 } },
      },
      plugins: {
        legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 10, font: { size: 11 } } },
        // Importe por barra en el tooltip: cada dataset de barra lleva un array paralelo
        // `importes` (ver barraAntiguedad()) con la suma real de `deposito` de ese bucket —
        // mismo patrón ya usado en el resto del panel (`xImporte` junto a cada conteo).
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const base = `${ctx.dataset.label}: ${ctx.formattedValue}`;
              const importe = ctx.dataset.importes?.[ctx.dataIndex];
              return importe == null ? base : `${base} (${this.formatImporte(importe)})`;
            },
          },
        },
        // Config global de datalabels: solo lo que comparten TODOS los labels del chart
        // (segmento + total). `clamp:true` evita que el label de total se corte contra el
        // borde del canvas en vez de desaparecer. El resto (anchor/align/color/formatter) se
        // fija por dataset en barraAntiguedad() porque cada segmento necesita su propio color
        // de texto según el contraste contra su color de fondo (ver comentario ahí).
        datalabels: { clamp: true, font: { family: 'Outfit, sans-serif' } },
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

  // Antigüedad del backlog (2026-10-28): se pidió la primera vez que se cargó, o cuando
  // `banco` realmente cambia — ver load(). NO fetch automático en ngOnInit (mismo patrón
  // perezoso que periodoRolCargado arriba: solo se dispara cuando el carousel padre activa
  // este slide con load()).
  private antiguedadCargada = false;

  /** Dispara el fetch — llamado por el carousel (padre) al activar/recargar este slide. */
  load(banco?: string | null): void {
    const bancoCambio = banco !== undefined && banco !== this.banco;
    if (banco !== undefined) this.banco = banco;
    this.loadTrigger$.next();
    // Antigüedad del backlog solo depende de `banco` (independiente de periodo/corte
    // histórico) — recargar solo la primera vez o si `banco` cambió, para no repetirla en
    // cada load() del carousel padre (recargas periódicas del slide activo).
    if (!this.antiguedadCargada || bancoCambio) {
      this.antiguedadCargada = true;
      this.cargarAntiguedad();
    }
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

  private cargarAntiguedad(): void {
    this.antiguedadLoading = true;
    this.antiguedadError   = false;
    this.bankService.antiguedadCorte(this.banco).pipe(takeUntil(this.destroy$)).subscribe({
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

  // Orden fijo de los 5 buckets (de más reciente a más vieja) — el backend puede no garantizar
  // el orden del array. Bucket 'Hoy' agregado 2026-10-28: antes el bucket más reciente era
  // '0-30' (incluía el día de carga); ahora el día 0 se separa a su propio bucket y '0-30' pasa
  // a ser '1-30' (1 ≤ días transcurridos < 30) — ver bank-indicadores.service.js#_bucketAntiguedadExpr.
  private static readonly ORDEN_BUCKETS: Array<BankCorteAntiguedadBucket['bucket']> = ['Hoy', '1-30', '30-60', '60-90', '90+'];
  private static readonly LABELS_BUCKETS: Record<BankCorteAntiguedadBucket['bucket'], string> = {
    'Hoy': 'Hoy', '1-30': '1-30 días', '30-60': '30-60 días', '60-90': '60-90 días', '90+': '90+ días',
  };

  // Barras apiladas con etiquetas (2026-10-28) — mismo mecanismo ya construido para el chart
  // anterior de Tendencia (stacked, datalabels por segmento + total arriba del stack), aplicado
  // ahora a los 5 buckets fijos de antigüedad del backlog ACTUAL (sin periodo, sin navegación
  // histórica — ver bank-indicadores.service.js#getCorteAntiguedadBacklog). 3 datasets fijos por
  // bucket: iniciales/nuevos/identificados (ver barraAntiguedad()) — "nuevos" por construcción
  // solo puede ser >0 en el bucket 'Hoy' (y, simétricamente, "iniciales" siempre da 0 ahí —
  // ambos esperados, no son bugs).
  //
  // Paleta: reusa los mismos colores ya usados en el chart anterior para estos 3 conceptos —
  // ámbar (#b5790a, igual que .corte-hero-stat--rezagados.is-alerta) para "iniciales", índigo
  // (#6a72e0, igual que el acento de marca ya usado en botones/switch de este panel) para
  // "nuevos", verde (#0e9c6f, igual que .corte-hero-stat--identificados) para "identificados" —
  // consistencia visual con el resto del panel, sin inventar un color nuevo.
  private buildAntiguedadChart(antiguedad: BankCorteAntiguedad): void {
    const porBucket = new Map(antiguedad.buckets.map(b => [b.bucket, b]));
    const bucketsOrdenados = BankCortePanelComponent.ORDEN_BUCKETS.map(
      (bucket): BankCorteAntiguedadBucket => porBucket.get(bucket) ?? {
        bucket, iniciales: 0, inicialesImporte: 0, nuevos: 0, nuevosImporte: 0, identificados: 0, identificadosImporte: 0,
      },
    );
    const labels = BankCortePanelComponent.ORDEN_BUCKETS.map(b => BankCortePanelComponent.LABELS_BUCKETS[b]);

    const iniciales        = bucketsOrdenados.map(b => b.iniciales);
    const nuevos           = bucketsOrdenados.map(b => b.nuevos);
    const identificados    = bucketsOrdenados.map(b => b.identificados);
    const inicialesImporte = bucketsOrdenados.map(b => b.inicialesImporte);
    const nuevosImporte    = bucketsOrdenados.map(b => b.nuevosImporte);
    const identificadosImporte = bucketsOrdenados.map(b => b.identificadosImporte);

    this.antiguedadChartData = {
      labels,
      datasets: [
        this.barraAntiguedad('No identificados iniciales', iniciales, '#b5790a', 'rgba(181,121,10,.35)', '#fff', inicialesImporte),
        this.barraAntiguedad('Nuevos no identificados', nuevos, '#6a72e0', 'rgba(106,114,224,.35)', '#fff', nuevosImporte),
        this.barraAntiguedad('Identificados', identificados, '#0e9c6f', 'rgba(14,156,111,.4)', '#fff', identificadosImporte, true),
      ],
    };
  }

  /** `colorTexto`: color del label DENTRO del segmento — blanco para los 3 colores de esta
   *  paleta (#b5790a/#6a72e0/#0e9c6f), buen contraste en los 3 casos (fórmula YIQ, mismo
   *  criterio que la doc de chartjs-plugin-datalabels). `esTotal`: solo el dataset que queda
   *  arriba del stack (ver buildAntiguedadChart) — además del label de su propio segmento,
   *  agrega un segundo datalabel (forma array, ver docs del plugin) con el TOTAL del bucket
   *  completo, suma de los 3 datasets en ese índice. */
  private barraAntiguedad(
    label: string, data: number[], borderColor: string, backgroundColor: string,
    colorTexto: string, importes?: number[], esTotal = false,
  ) {
    // Valor 0 → sin label (null): un "0" dentro de un segmento vacío solo ensucia el chart sin
    // aportar información (el segmento ya se ve vacío).
    const formatValor = (valor: number) => (valor === 0 ? null : valor.toLocaleString('es-MX'));
    // `value` lo pasa Chart.js/datalabels como 1er argumento del formatter: es el dato propio
    // de ESTE dataset en ese índice (no el total apilado) — correcto para el label de segmento.
    const datalabelSegmento = {
      anchor: 'center' as const,
      align: 'center' as const,
      color: colorTexto,
      font: { size: 10, weight: 600 as const },
      formatter: (value: number) => formatValor(value),
    };
    const datalabels = esTotal
      ? [
          datalabelSegmento,
          {
            anchor: 'end' as const,
            align: 'top' as const,
            color: '#1c2a3a',
            font: { size: 11, weight: 'bold' as const },
            formatter: (_value: number, ctx: any) => {
              const total = ctx.chart.data.datasets.reduce(
                (acc: number, ds: any) => acc + (ds.data[ctx.dataIndex] ?? 0), 0,
              );
              // Mismo criterio que el label de segmento: un total de 0 no aporta nada, mejor
              // no dibujarlo.
              return total === 0 ? null : total.toLocaleString('es-MX');
            },
          },
        ]
      : datalabelSegmento;
    return { type: 'bar', label, data, backgroundColor, borderColor, borderWidth: 1, importes, datalabels };
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
