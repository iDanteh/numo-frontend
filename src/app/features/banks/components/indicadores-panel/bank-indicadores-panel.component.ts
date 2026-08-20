import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { catchError, switchMap, takeUntil } from 'rxjs/operators';
import { of } from 'rxjs';
import { CollectionRequestService, CollectionRequestIndicadores } from '../../../../core/services/collection-request.service';

interface LoadRequest {
  year:  number | null;
  month: number | null;
}

/**
 * Slide 2 del dashboard de Bancos — tiempo de identificación de Solicitudes de Cobro.
 *
 * 2026-08-20 (2da corrección, pedido explícito del usuario tras ver la primera versión):
 * el indicador GENERAL (todas las vías: fichas, aplicación directa, motores automáticos)
 * y "Promedio por usuario" se ELIMINARON de este panel — el usuario dijo explícitamente
 * que no le interesan, que empujaban las tarjetas de bancos fuera de la vista (scroll
 * innecesario), y que solo le importa el dato acotado a Solicitudes de Cobro + el
 * desglose "por contador". Este panel ahora es 100% ese indicador — ver
 * collection-request-indicadores.service.js para el criterio de cálculo completo
 * (total/fase1Banco en reloj real, fase2Contador en horas hábiles).
 *
 * Fetch perezoso: nunca se auto-carga en ngOnInit; el padre (BankDashboardCarouselComponent)
 * llama a load() explícitamente la primera vez que este slide se activa, y de nuevo cuando
 * los filtros cambian mientras está activo (o quedaron "stale" al reactivarlo). `load()`
 * sigue aceptando banco/categoria (el padre los sigue mandando, ver
 * bank-dashboard-carousel.component.html) por compatibilidad de firma — CollectionRequest
 * no se filtra por banco/categoria, así que se ignoran a propósito.
 */
@Component({
  standalone: false,
  selector: 'app-bank-indicadores-panel',
  templateUrl: './bank-indicadores-panel.component.html',
  styleUrls: ['./bank-indicadores-panel.component.css'],
})
export class BankIndicadoresPanelComponent implements OnInit, OnDestroy {
  @Input() banco:     string | null = null;
  @Input() categoria: string | null = null;
  @Input() year:      number | null = null;
  @Input() month:     number | null = null;

  // Descripciones de cada fase para el tooltip nativo de "Reparto por fase" — pedido
  // explícito del usuario (2026-08-20): al pasar el mouse sobre la barra o su leyenda,
  // no alcanza con ver la duración, hace falta explicar QUÉ mide cada tramo.
  readonly FASE_BANCO_DESC =
    'Desde que la tienda crea la solicitud hasta que el depósito bancario es visible en Numo. No depende de tu equipo — es tiempo del banco/Kore.';
  readonly FASE_CONTADOR_DESC =
    'Desde que el depósito ya es visible en Numo hasta que el contador identifica la solicitud. Medido en horas hábiles.';

  crData:    CollectionRequestIndicadores | null = null;
  crLoading = false;
  crError   = false;

  // Colapsado por default (mismo criterio que el resto de los desplegables de este
  // dashboard) — el desglose por contador puede tener una fila por cada contador del
  // equipo; el total + el reparto por fase (siempre visibles, arriba) ya cubren la
  // pregunta principal sin necesitar la tabla abierta.
  private static readonly POR_CONTADOR_COLLAPSED_KEY = 'numo_bank_indicadores_por_contador_collapsed';
  porContadorCollapsed = this.readPorContadorCollapsed();

  private loadTrigger$ = new Subject<LoadRequest>();
  private destroy$      = new Subject<void>();

  constructor(private crService: CollectionRequestService) {}

  ngOnInit(): void {
    // switchMap cancela un fetch en vuelo si llega uno nuevo antes de resolver — mismo
    // patrón que cardsLoadTrigger$/loadTrigger$ en banks.component.ts, para que un cambio
    // rápido de filtros nunca deje una respuesta vieja pisando a la nueva.
    this.loadTrigger$.pipe(
      switchMap(req => {
        this.crLoading = true;
        this.crError   = false;
        return this.crService.indicadores(req.year ?? undefined, req.month ?? undefined).pipe(
          catchError(() => { this.crError = true; return of(null); }),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe(res => {
      this.crLoading = false;
      if (res) this.crData = res;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Dispara el fetch. Acepta los filtros explícitos (en vez de leer siempre this.year/etc.)
   * porque quien la llama (el carousel, reaccionando a un cambio de @Input() recién ocurrido
   * en SU PROPIO ngOnChanges) podría hacerlo antes de que Angular termine de propagar esos
   * mismos valores hacia los @Input() de este componente hijo en el mismo ciclo de change
   * detection. `banco`/`categoria` se aceptan solo por compatibilidad de firma con el padre
   * (bank-dashboard-carousel.component) — CollectionRequest no se filtra por esos campos.
   */
  load(
    _banco?:     string | null,
    _categoria?: string | null,
    year?:       number | null,
    month?:      number | null,
  ): void {
    this.loadTrigger$.next({
      year:  year  !== undefined ? year  : this.year,
      month: month !== undefined ? month : this.month,
    });
  }

  /**
   * % de ancho para el PRIMER segmento de una barra de 2 tramos (fase banco/Kore vs.
   * fase contador) — mismo motivo visual que las barras de antigüedad de otros paneles:
   * de un vistazo se ve en cuál de las 2 fases se concentra la demora, sin tener que
   * comparar 2 números manualmente. `horasA`/`horasB` son proporciones visuales, no una
   * suma con significado propio (fase2Contador está en horas hábiles, fase1Banco en
   * reloj real — no se combinan en ningún cálculo, solo se comparan lado a lado).
   */
  flowSegPct(horasA: number, horasB: number): number {
    const total = horasA + horasB;
    return total > 0 ? (horasA / total) * 100 : 50;
  }

  /** Mismos cortes que el resto del dashboard de Bancos (24h / 72h / 168h). */
  promedioTone(horas: number): 'good' | 'warn' | 'warn2' | 'critical' {
    if (horas < 24) return 'good';
    if (horas < 72) return 'warn';
    if (horas < 168) return 'warn2';
    return 'critical';
  }

  promedioToneLabel(tone: 'good' | 'warn' | 'warn2' | 'critical'): string {
    switch (tone) {
      case 'good':     return 'En objetivo';
      case 'warn':     return 'Elevado';
      case 'warn2':    return 'Alto';
      case 'critical': return 'Crítico';
    }
  }

  /**
   * "2h 15m" / "4 días 5h 42m" — SIEMPRE con minutos, sin importar la magnitud (pedido
   * explícito del usuario: "quiero ver los minutos, no solo el promedio en horas"). El
   * caso multi-día se deriva del total de MINUTOS (no de horas ya redondeadas) para que
   * el acarreo entre horas/días sea siempre consistente.
   */
  formatPromedio(horas: number): string {
    const totalMinutos = Math.round(horas * 60);
    const dias          = Math.floor(totalMinutos / 1440);
    const restoMin       = totalMinutos % 1440;
    const h             = Math.floor(restoMin / 60);
    const m             = restoMin % 60;
    if (dias > 0) return `${dias} día${dias === 1 ? '' : 's'} ${h}h ${m}m`;
    return `${h}h ${m}m`;
  }

  togglePorContador(): void {
    this.porContadorCollapsed = !this.porContadorCollapsed;
    try {
      localStorage.setItem(BankIndicadoresPanelComponent.POR_CONTADOR_COLLAPSED_KEY, String(this.porContadorCollapsed));
    } catch {
      // localStorage puede fallar en modo privado/cuota llena — la preferencia simplemente no persiste.
    }
  }

  private readPorContadorCollapsed(): boolean {
    try {
      const v = localStorage.getItem(BankIndicadoresPanelComponent.POR_CONTADOR_COLLAPSED_KEY);
      return v === null ? true : v === 'true';
    } catch {
      return true;
    }
  }
}
