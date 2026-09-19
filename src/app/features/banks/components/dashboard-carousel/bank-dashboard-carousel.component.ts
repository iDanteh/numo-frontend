import {
  Component, Input, OnInit, OnChanges, AfterViewInit, SimpleChanges, ViewChild,
} from '@angular/core';
import { BankIndicadoresPanelComponent } from '../indicadores-panel/bank-indicadores-panel.component';
import { BankCobranzaPanelComponent } from '../cobranza-panel/bank-cobranza-panel.component';
import { AuthService } from '../../../../core/services/auth.service';

export type BankDashboardSlide = 'kpi' | 'indicadores' | 'cobranza';

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
 *  - Slide 3 ("cobranza", 2026-09-17): <app-bank-cobranza-panel>, mismo patrón de fetch
 *    perezoso que el slide 2 — par propio hasLoadedCobranzaOnce/cobranzaStale, nada
 *    especial respecto a los otros 2 slides.
 *
 * Persistencia: localStorage bajo NUMO_BANK_DASHBOARD_SLIDE_KEY, valores
 * 'kpi'|'indicadores'|'cobranza'.
 *
 * Visibilidad por rol (2026-09-18, pedido explícito del usuario): el rol `cobranza` NUNCA
 * ve la pestaña "Solicitudes de Cobro" (slide 'indicadores') — solo Estatus + Cobranza.
 * Cualquier otro rol (admin, contabilidad, etc.) sigue viendo las 3. Esto es una decisión
 * de UX/producto, NO un boquete de seguridad: el rol `cobranza` ya tiene `collections:read`
 * y `collections:write` completos en rbac.js (accede a esos mismos datos por la bandeja de
 * gestión) — el gate acá es solo "no mostrarle esta pestaña del dashboard", nada de
 * permisos backend cambia. Ver *ngIf en el .html sobre el botón/slide de 'indicadores', y
 * los 2 resguardos de abajo (ngOnInit/selectSlide) para que ni una preferencia vieja en
 * localStorage ni una llamada directa a selectSlide('indicadores') dejen a un usuario
 * cobranza en un slide sin botón ni contenido.
 */
@Component({
  standalone: false,
  selector: 'app-bank-dashboard-carousel',
  templateUrl: './bank-dashboard-carousel.component.html',
  styleUrls: ['./bank-dashboard-carousel.component.css'],
})
export class BankDashboardCarouselComponent implements OnInit, OnChanges, AfterViewInit {
  static readonly STORAGE_KEY = 'numo_bank_dashboard_slide';

  constructor(public auth: AuthService) {}

  // Mismos filtros que ya gobiernan el slide 1 (dueños en BanksComponent) — reusados tal
  // cual como @Input() para alimentar el slide 2 (BankIndicadoresPanelComponent).
  @Input() banco:     string | null = null;
  @Input() categoria: string | null = null;
  @Input() year:      number | null = null;
  @Input() month:     number | null = null;

  @ViewChild(BankIndicadoresPanelComponent) private indicadoresPanelRef?: BankIndicadoresPanelComponent;
  @ViewChild(BankCobranzaPanelComponent)    private cobranzaPanelRef?:    BankCobranzaPanelComponent;

  activeSlide: BankDashboardSlide = 'kpi';

  private hasLoadedIndicadoresOnce = false;
  private indicadoresStale         = false;
  private hasLoadedCobranzaOnce    = false;
  private cobranzaStale            = false;

  ngOnInit(): void {
    const saved = this.readStoredSlide();
    // Preferencia vieja 'indicadores' + rol cobranza (de antes de este gate, o un cambio de
    // rol posterior): esa pestaña ya no existe para él, cae a 'kpi' en vez de activar un
    // slide sin botón ni contenido en el DOM.
    const indicadoresValido = saved === 'indicadores' && !this.auth.hasRole('cobranza');
    this.activeSlide = indicadoresValido || saved === 'cobranza' ? (saved as BankDashboardSlide) : 'kpi';
  }

  ngAfterViewInit(): void {
    // Si la preferencia persistida ya arranca en "indicadores"/"cobranza", el fetch
    // perezoso se dispara aquí (primera vez que el slide está activo), no en el ngOnInit
    // del hijo. Diferido a un microtask: mutar datos del hijo sincrónicamente dentro de
    // ngAfterViewInit del padre dispararía NG0100 (ExpressionChangedAfterItHasBeenCheckedError)
    // si el servicio resuelve en el mismo tick — nunca pasa con la llamada HTTP real
    // (siempre async), pero sí con un spy de test que devuelve `of(...)` síncrono.
    // Promise.resolve() corre después de que Angular termine de chequear todo el árbol de
    // este ciclo, sin cambiar el comportamiento real.
    if (this.activeSlide === 'indicadores') {
      Promise.resolve().then(() => this.triggerLoadIndicadores());
    } else if (this.activeSlide === 'cobranza') {
      Promise.resolve().then(() => this.triggerLoadCobranza());
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Angular solo incluye en `changes` los @Input() cuyo valor realmente cambió desde la
    // última verificación — no hace falta revisar `firstChange` aparte: para cada slide, si
    // ya cargó al menos una vez, cualquier entrada aquí es un cambio real de filtro.
    const filtersChanged = (['banco', 'categoria', 'year', 'month'] as const)
      .some(key => key in changes);

    if (this.hasLoadedIndicadoresOnce && filtersChanged) {
      if (this.activeSlide === 'indicadores') this.triggerLoadIndicadores();
      else this.indicadoresStale = true;
    }
    if (this.hasLoadedCobranzaOnce && filtersChanged) {
      if (this.activeSlide === 'cobranza') this.triggerLoadCobranza();
      else this.cobranzaStale = true;
    }
  }

  selectSlide(slide: BankDashboardSlide): void {
    // Cinturón y tirantes: el botón de 'indicadores' ya no existe en el DOM para cobranza
    // (ver *ngIf en el .html), pero si algo igual dispara esto (ej. un handler viejo), no
    // debe activarse un slide sin contenido.
    if (slide === 'indicadores' && this.auth.hasRole('cobranza')) return;
    if (slide === this.activeSlide) return;
    this.activeSlide = slide;
    this.writeStoredSlide(slide);
    if (slide === 'indicadores' && (!this.hasLoadedIndicadoresOnce || this.indicadoresStale)) {
      this.triggerLoadIndicadores();
    }
    if (slide === 'cobranza' && (!this.hasLoadedCobranzaOnce || this.cobranzaStale)) {
      this.triggerLoadCobranza();
    }
  }

  private triggerLoadIndicadores(): void {
    this.hasLoadedIndicadoresOnce = true;
    this.indicadoresStale         = false;
    this.indicadoresPanelRef?.load(this.banco, this.categoria, this.year, this.month);
  }

  private triggerLoadCobranza(): void {
    this.hasLoadedCobranzaOnce = true;
    this.cobranzaStale         = false;
    this.cobranzaPanelRef?.load(this.banco, this.categoria, this.year, this.month);
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
