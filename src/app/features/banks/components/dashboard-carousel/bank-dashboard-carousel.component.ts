import {
  Component, Input, OnInit, OnChanges, AfterViewInit, SimpleChanges, ViewChild,
} from '@angular/core';
import { BankIndicadoresPanelComponent } from '../indicadores-panel/bank-indicadores-panel.component';

export type BankDashboardSlide = 'kpi' | 'indicadores';

/**
 * Shell de carousel de 2 slides para el dashboard de Bancos:
 *  - Slide 1 ("kpi"): contenido proyectado vía <ng-content> — el toolbar de filtros y la
 *    franja de tarjetas de estatus SIGUEN viviendo tal cual en banks.component.html/ts.
 *    Se decidió NO mover ese estado (dashboardBanco, filterCategoria, bankCards, etc.) a
 *    este componente: se descubrió que `bankCards` también lo usan `activeCard` (getter
 *    de la vista detalle), `onBancoConfigSaved()` y `<app-report-panel [bankCards]>`, todos
 *    en banks.component.ts, fuera de la vista "cards" — mover ese estado a un componente
 *    que se destruye al cambiar a la vista "detail" (dentro de un *ngIf="view==='cards'")
 *    rompería esos 3 usos. Content projection logra el carousel visual sin ese riesgo.
 *  - Slide 2 ("indicadores"): <app-bank-indicadores-panel>, con fetch perezoso — su método
 *    load() solo se llama desde aquí (hasLoadedOnce/stale viven en este padre), nunca en el
 *    ngOnInit del hijo.
 *
 * Persistencia: localStorage bajo NUMO_BANK_DASHBOARD_SLIDE_KEY, valores 'kpi'|'indicadores'.
 */
@Component({
  standalone: false,
  selector: 'app-bank-dashboard-carousel',
  templateUrl: './bank-dashboard-carousel.component.html',
  styleUrls: ['./bank-dashboard-carousel.component.css'],
})
export class BankDashboardCarouselComponent implements OnInit, OnChanges, AfterViewInit {
  static readonly STORAGE_KEY = 'numo_bank_dashboard_slide';

  // Mismos filtros que ya gobiernan el slide 1 (dueños en BanksComponent) — reusados tal
  // cual como @Input() para alimentar el slide 2 (BankIndicadoresPanelComponent).
  @Input() banco:     string | null = null;
  @Input() categoria: string | null = null;
  @Input() year:      number | null = null;
  @Input() month:     number | null = null;

  @ViewChild(BankIndicadoresPanelComponent) private indicadoresPanelRef?: BankIndicadoresPanelComponent;

  activeSlide: BankDashboardSlide = 'kpi';

  private hasLoadedIndicadoresOnce = false;
  private indicadoresStale         = false;

  ngOnInit(): void {
    const saved = this.readStoredSlide();
    this.activeSlide = saved === 'indicadores' ? 'indicadores' : 'kpi';
  }

  ngAfterViewInit(): void {
    // Si la preferencia persistida ya arranca en "indicadores", el fetch perezoso se
    // dispara aquí (primera vez que el slide está activo), no en el ngOnInit del hijo.
    // Diferido a un microtask: mutar datos del hijo (BankIndicadoresPanelComponent)
    // sincrónicamente dentro de ngAfterViewInit del padre dispararía NG0100
    // (ExpressionChangedAfterItHasBeenCheckedError) si el servicio resuelve en el mismo
    // tick — nunca pasa con la llamada HTTP real (siempre async), pero sí con un spy de
    // test que devuelve `of(...)` síncrono. Promise.resolve() corre después de que Angular
    // termine de chequear todo el árbol de este ciclo, sin cambiar el comportamiento real.
    if (this.activeSlide === 'indicadores') {
      Promise.resolve().then(() => this.triggerLoad());
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Nada que invalidar todavía: el primer set de @Input() (ngOnChanges siempre corre antes
    // de ngOnInit/ngAfterViewInit) no puede volver "obsoleto" un fetch que aún no ocurrió.
    if (!this.hasLoadedIndicadoresOnce) return;

    // Angular solo incluye en `changes` los @Input() cuyo valor realmente cambió desde la
    // última verificación — no hace falta revisar `firstChange` aparte: para este punto
    // (hasLoadedIndicadoresOnce ya es true) cualquier entrada aquí es un cambio real de filtro.
    const filtersChanged = (['banco', 'categoria', 'year', 'month'] as const)
      .some(key => key in changes);
    if (!filtersChanged) return;

    if (this.activeSlide === 'indicadores') {
      this.triggerLoad();
    } else {
      this.indicadoresStale = true;
    }
  }

  selectSlide(slide: BankDashboardSlide): void {
    if (slide === this.activeSlide) return;
    this.activeSlide = slide;
    this.writeStoredSlide(slide);
    if (slide === 'indicadores' && (!this.hasLoadedIndicadoresOnce || this.indicadoresStale)) {
      this.triggerLoad();
    }
  }

  private triggerLoad(): void {
    this.hasLoadedIndicadoresOnce = true;
    this.indicadoresStale         = false;
    this.indicadoresPanelRef?.load(this.banco, this.categoria, this.year, this.month);
  }

  private readStoredSlide(): string | null {
    try {
      return localStorage.getItem(BankDashboardCarouselComponent.STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private writeStoredSlide(slide: BankDashboardSlide): void {
    try {
      localStorage.setItem(BankDashboardCarouselComponent.STORAGE_KEY, slide);
    } catch {
      // localStorage puede fallar en modo privado/cuota llena — la preferencia simplemente
      // no persiste, no es motivo para romper el switch de slides.
    }
  }
}
