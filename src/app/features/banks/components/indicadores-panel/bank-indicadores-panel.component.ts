import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { catchError, switchMap, takeUntil } from 'rxjs/operators';
import { of } from 'rxjs';
import { BankService, BankIndicadoresIdentificacion } from '../../../../core/services/bank.service';

interface LoadRequest {
  banco:     string | null;
  categoria: string | null;
  year:      number | null;
  month:     number | null;
}

/**
 * Slide 2 del dashboard de Bancos — indicador "tiempo de identificación".
 * Fetch perezoso: nunca se auto-carga en ngOnInit; el padre (BankDashboardCarouselComponent)
 * llama a load() explícitamente la primera vez que este slide se activa, y de nuevo cuando
 * los filtros cambian mientras está activo (o quedaron "stale" al reactivarlo).
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

  data:    BankIndicadoresIdentificacion | null = null;
  loading = false;
  error   = false;

  private loadTrigger$ = new Subject<LoadRequest>();
  private destroy$      = new Subject<void>();

  constructor(private bankService: BankService) {}

  ngOnInit(): void {
    // switchMap cancela un fetch en vuelo si llega uno nuevo antes de resolver — mismo
    // patrón que cardsLoadTrigger$/loadTrigger$ en banks.component.ts, para que un cambio
    // rápido de filtros nunca deje una respuesta vieja pisando a la nueva.
    this.loadTrigger$.pipe(
      switchMap(req => {
        this.loading = true;
        this.error   = false;
        return this.bankService.indicadores(req.banco, req.categoria, req.year, req.month).pipe(
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

  /**
   * Dispara el fetch. Acepta los filtros explícitos (en vez de leer siempre this.banco/etc.)
   * porque quien la llama (el carousel, reaccionando a un cambio de @Input() recién ocurrido
   * en SU PROPIO ngOnChanges) podría hacerlo antes de que Angular termine de propagar esos
   * mismos valores hacia los @Input() de este componente hijo en el mismo ciclo de change
   * detection — leer this.banco en ese instante arriesgaría un valor todavía viejo. Sin
   * argumentos (ej. un botón "Reintentar" en el propio template), cae a los @Input() actuales.
   */
  load(
    banco?:     string | null,
    categoria?: string | null,
    year?:      number | null,
    month?:     number | null,
  ): void {
    this.loadTrigger$.next({
      banco:     banco     !== undefined ? banco     : this.banco,
      categoria: categoria !== undefined ? categoria : this.categoria,
      year:      year      !== undefined ? year      : this.year,
      month:     month     !== undefined ? month     : this.month,
    });
  }

  /**
   * Total de no identificados en las 4 categorías de antigüedad, para el grupo pedido.
   * `historico` = ya estaba sin identificar antes de activar este indicador (marca
   * inmutable `backlogPreExistente`, estampada una sola vez por
   * migrate-backlog-preexistente.js); `nuevo` = apareció después. Se muestran los 2 por
   * separado a propósito — nunca combinados — para no esconder un backlog histórico
   * grande detrás de un número que solo refleja lo reciente.
   */
  backlogTotal(grupo: 'historico' | 'nuevo'): number {
    if (!this.data) return 0;
    const b = this.data.backlog[grupo];
    return b.menos24h + b.de1a3d + b.de3a7d + b.mas7d;
  }

  /** % de ancho que le toca a un bucket dentro de la barra de antigüedad de ESE grupo. */
  agingPct(grupo: 'historico' | 'nuevo', count: number): number {
    const total = this.backlogTotal(grupo);
    return total > 0 ? (count / total) * 100 : 0;
  }

  /**
   * Clasifica el promedio con los MISMOS cortes que el backlog por antigüedad
   * (BACKLOG_BOUNDARIES en bank-indicadores.service.js: 24h / 72h / 168h) — así el chip
   * del hero y las barras de abajo comparten una sola escala de color, no dos.
   */
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

  /** "3 horas" / "1 día 4 h" — legible sin ser ambiguo, redondeado a la hora entera. */
  formatPromedio(horas: number): string {
    if (horas < 24) {
      const h = Math.round(horas * 10) / 10;
      return `${h} hora${h === 1 ? '' : 's'}`;
    }
    const dias  = Math.floor(horas / 24);
    const resto = Math.round(horas % 24);
    return `${dias} día${dias === 1 ? '' : 's'} ${resto} h`;
  }
}
