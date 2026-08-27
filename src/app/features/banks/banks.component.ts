import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ErpModalComponent } from './components/erp-modal/erp-modal.component';
import { CobroPanelComponent } from './components/cobro-panel/cobro-panel.component';
import * as XLSX from 'xlsx';
import { FormBuilder, FormGroup } from '@angular/forms';
import { merge, of, Observable, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, takeUntil } from 'rxjs/operators';
import {
  BankService, BankMovement, BankCard, BankFilter, BankStatus,
  BankIdentificador, UpdateMovementDto, BankStatusStats,
} from '../../core/services/bank.service';
import { AuthService } from '../../core/services/auth.service';
import { SocketService } from '../../core/services/socket.service';

type ViewMode  = 'cards' | 'detail';
type SortDir   = 'asc' | 'desc';
type SortField = 'fecha' | 'banco' | 'deposito' | 'retiro' | 'diferencia' | 'saldo-erp';
type StatusKey = 'no_identificado' | 'identificado' | 'otros' | 'reclasificado';

@Component({
  standalone: false,
  selector: 'app-banks',
  templateUrl: './banks.component.html',
  styleUrls: ['./banks.component.css'],
})
export class BanksComponent implements OnInit, AfterViewInit, OnDestroy {

  readonly Math = Math;

  // ── Vista ───────────────────────────────────────────────────────────────────
  view: ViewMode = 'cards';
  activeBanco: string | null = null;
  // ── Tarjetas ────────────────────────────────────────────────────────────────
  bankCards:    BankCard[] = [];
  cardsLoading  = false;

  /** Oculta la columna "Saldo actualizado" de `.banks-table` (2026-07-24, a pedido del
   *  usuario: "no lo necesito por ahora") — solo se oculta la columna, el dato y el
   *  getter/campo (`card.saldoActualizado`) siguen intactos. Poner en `true` la reactiva. */
  showSaldoActualizadoBanksCol = false;

  // ── Filtros combinables de la vista unificada (dashboard + tabla) ────────────
  // AND lógico, un solo valor por filtro (no multi-selección) — confirmado con UX.
  dashboardYear:   number | null = null;
  dashboardMonth:  number | null = null;
  dashboardBanco:  string | null = null;   // también filtra filas de la tabla, no solo el KPI
  filterCategoria: string | null = null;
  filterStatus:    StatusKey | '' = '';
  availableYears:  number[] = [];

  // ── Buscador global de movimientos (dashboard) ───────────────────────────────
  // Reemplaza el viejo buscador de "banco o cuenta" (filtraba en memoria las ~4-6
  // tarjetas ya visibles en pantalla — poco útil). Este busca movimientos por importe/
  // concepto en TODOS los bancos, reusando GET /banks/movements sin filtro `banco` —
  // el backend ya prioriza coincidencias de importe sobre concepto en su scoring
  // (bank.service.js), así que no hace falta ningún cambio de backend.
  globalSearchTerm      = '';
  globalSearchResults:  BankMovement[] = [];
  globalSearchLoading   = false;
  globalSearchOpen      = false;
  globalSearchActiveIdx = -1;
  private globalSearch$ = new Subject<string>();

  /** Sólo se muestran las primeras `CATEGORIAS_VISIBLES` en la fila; el resto vive en el popover "+N más". */
  readonly CATEGORIAS_VISIBLES = 6;
  categoriasPopoverBanco: string | null = null;
  categoriasPopoverPos:  { bottom: number; right: number } | null = null;

  readonly MESES = [
    { value: 1,  label: 'Enero' },   { value: 2,  label: 'Febrero' },
    { value: 3,  label: 'Marzo' },   { value: 4,  label: 'Abril' },
    { value: 5,  label: 'Mayo' },    { value: 6,  label: 'Junio' },
    { value: 7,  label: 'Julio' },   { value: 8,  label: 'Agosto' },
    { value: 9,  label: 'Septiembre' }, { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' },
  ];

  readonly statusOptions: { value: StatusKey; label: string }[] = [
    { value: 'identificado',    label: 'Identificado' },
    { value: 'otros',           label: 'Otros' },
    { value: 'reclasificado',   label: 'Por conciliar' },
    { value: 'no_identificado', label: 'No identificado' },
  ];

  /** "Otros" solo es seleccionable/visible para banks:config, igual que en el resto de la vista. */
  get statusFilterOptions(): { value: StatusKey; label: string }[] {
    return this.statusOptions.filter(o => o.value !== 'otros' || this.auth.hasPermission('banks:config'));
  }

  /** Nº de columnas de `.banks-table` — un solo lugar que mantener si la tabla gana/pierde columnas. */
  get banksTableColCount(): number {
    if (this.auth.hasRole('cobranza')) return 8;
    return this.showSaldoActualizadoBanksCol ? 10 : 9;
  }

  /** Bancos con tarjeta cargada — dinámico, a diferencia de `bancos` (catálogo fijo solo para importar). */
  get bancosDisponibles(): string[] {
    return Array.from(new Set(this.bankCards.map(c => c.banco))).sort();
  }

  /** Unión de categorías (porCategoria) de los bancos cargados; si hay un banco activo, solo las suyas. */
  get categoriasDisponibles(): { categoria: string; count: number }[] {
    const source = this.dashboardBanco
      ? this.bankCards.filter(c => c.banco === this.dashboardBanco)
      : this.bankCards;
    const totals = new Map<string, number>();
    for (const c of source) {
      for (const pc of c.porCategoria) {
        totals.set(pc.categoria, (totals.get(pc.categoria) ?? 0) + pc.count);
      }
    }
    return Array.from(totals, ([categoria, count]) => ({ categoria, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Tarjetas tras aplicar los filtros combinables (AND) — de aquí parte la TABLA de bancos. */
  get filteredBankCards(): BankCard[] {
    return this.bankCards.filter(c => {
      if (this.dashboardBanco && c.banco !== this.dashboardBanco) return false;
      if (this.filterCategoria && !c.porCategoria.some(pc => pc.categoria === this.filterCategoria)) return false;
      if (this.filterStatus && (c.porStatus[this.filterStatus] ?? 0) <= 0) return false;
      return true;
    });
  }

  // Bug real 2026-08-13: dashboardTotals/totalSaldoPendiente sumaban sobre filteredBankCards, que
  // ya excluye bancos con 0 movimientos en filterStatus — filtrar por un estatus hacía desaparecer
  // TAMBIÉN los otros 3 buckets de esos bancos del KPI, aunque la decisión de negocio (2026-07-31)
  // fue que el filtro de Estatus solo decide qué filas se listan, sin recalcular los KPIs. Base
  // separada, sin filterStatus, para que los totales KPI queden estables al filtrar por estatus.
  get bankCardsForKpi(): BankCard[] {
    return this.bankCards.filter(c => {
      if (this.dashboardBanco && c.banco !== this.dashboardBanco) return false;
      if (this.filterCategoria && !c.porCategoria.some(pc => pc.categoria === this.filterCategoria)) return false;
      return true;
    });
  }

  // Bug real 2026-07-31: filterCategoria solo decidía qué bancos se listan (filteredBankCards),
  // pero los KPIs seguían sumando el banco COMPLETO — filtrar por "Depósito en efectivo" no
  // cambiaba los montos mostrados, aunque el banco tuviera 200 movimientos de otras categorías.
  // Este helper es el único lugar que decide de dónde sale el desglose de un banco: si hay
  // categoría activa, usa la entrada escalada de porCategoria (backend ahora la trae con el
  // mismo desglose que el banco completo — ver bank.service.js#getCards); si no, el banco entero
  // (comportamiento de siempre). Se usa en TODOS los lugares que antes leían
  // card.porStatus/saldoPendiente/etc. directo, para que dashboard y tabla nunca se desincronicen.
  cardStats(card: BankCard): {
    porStatus: BankCard['porStatus'];
    saldoPendiente: number; saldoIdentificado: number;
    saldoOtrosSolo: number; saldoReclasificado: number;
  } {
    if (this.filterCategoria) {
      const pc = card.porCategoria.find(c => c.categoria === this.filterCategoria);
      if (pc) return pc;
    }
    return {
      porStatus:          card.porStatus,
      saldoPendiente:     card.saldoPendiente,
      saldoIdentificado:  card.saldoIdentificado,
      saldoOtrosSolo:     card.saldoOtrosSolo,
      saldoReclasificado: card.saldoReclasificado,
    };
  }

  get dashboardTotals(): Omit<BankStatusStats, 'years'> {
    const t = {
      no_identificado: 0, identificado: 0, otros: 0, reclasificado: 0,
      dep_no_identificado: 0, dep_identificado: 0, dep_otros: 0, dep_reclasificado: 0,
    };
    for (const c of this.bankCardsForKpi) {
      const s = this.cardStats(c);
      t.no_identificado     += s.porStatus.no_identificado ?? 0;
      t.identificado        += s.porStatus.identificado    ?? 0;
      t.otros               += s.porStatus.otros           ?? 0;
      t.reclasificado       += s.porStatus.reclasificado   ?? 0;
      t.dep_no_identificado += s.saldoPendiente     ?? 0;
      t.dep_identificado    += s.saldoIdentificado  ?? 0;
      t.dep_otros           += s.saldoOtrosSolo     ?? 0;
      t.dep_reclasificado   += s.saldoReclasificado ?? 0;
    }
    return t;
  }

  /** Suma de las 4 categorías del motor de reglas sobre los bancos ya filtrados. */
  get dashboardTotalCount(): number {
    const t = this.dashboardTotals;
    return t.no_identificado + t.identificado + t.otros + t.reclasificado;
  }

  get dashboardTotalAmount(): number {
    const t = this.dashboardTotals;
    return t.dep_no_identificado + t.dep_identificado + t.dep_otros + t.dep_reclasificado;
  }

  /** % de un conteo sobre el total del dashboard (ya filtrado). */
  dashboardPct(count: number): number {
    const total = this.dashboardTotalCount;
    return total > 0 ? (count / total) * 100 : 0;
  }

  get dashboardResolvedPct(): number {
    return this.dashboardPct(this.dashboardTotals.identificado);
  }

  /** Umbral de severidad para el badge "% resuelto": no siempre es una buena noticia. */
  private resolvedTone(pct: number): 'critical' | 'warn' | 'good' {
    if (pct >= 80) return 'good';
    if (pct >= 40) return 'warn';
    return 'critical';
  }

  get dashboardResolvedTone(): 'critical' | 'warn' | 'good' {
    return this.resolvedTone(this.dashboardResolvedPct);
  }

  // ── Colapsar la franja de tarjetas KPI: el resumen (dashboard-head, con el total y el
  // % resuelto) siempre queda visible; lo único que se oculta es .status-cards-row, para
  // que quien solo quiere llegar a la tabla de movimientos no tenga que scrollear más de
  // lo necesario. Preferencia persistida (mismo criterio que STORAGE_KEY del carousel). ──
  private static readonly DASHBOARD_CARDS_COLLAPSED_KEY = 'numo_bank_dashboard_cards_collapsed';

  dashboardCardsCollapsed = this.readDashboardCardsCollapsed();

  toggleDashboardCards(): void {
    this.dashboardCardsCollapsed = !this.dashboardCardsCollapsed;
    try {
      localStorage.setItem(BanksComponent.DASHBOARD_CARDS_COLLAPSED_KEY, String(this.dashboardCardsCollapsed));
    } catch {
      // localStorage puede fallar en modo privado/cuota llena — la preferencia simplemente no persiste.
    }
  }

  private readDashboardCardsCollapsed(): boolean {
    try {
      return localStorage.getItem(BanksComponent.DASHBOARD_CARDS_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  }

  // ── Helpers por fila: distribución de estatus y % resuelto de cada banco ─────

  cardTotalCount(card: BankCard): number {
    const s = this.cardStats(card).porStatus;
    return (s.no_identificado ?? 0) + (s.identificado ?? 0) + (s.otros ?? 0) + (s.reclasificado ?? 0);
  }

  cardStatusPct(card: BankCard, key: StatusKey): number {
    const total = this.cardTotalCount(card);
    return total > 0 ? ((this.cardStats(card).porStatus[key] ?? 0) / total) * 100 : 0;
  }

  cardResolvedPct(card: BankCard): number {
    return this.cardStatusPct(card, 'identificado');
  }

  cardResolvedTone(card: BankCard): 'critical' | 'warn' | 'good' {
    return this.resolvedTone(this.cardResolvedPct(card));
  }

  // ── Chips de filtros activos ──────────────────────────────────────────────────

  filterStatusLabel(key: string): string {
    return this.statusOptions.find(o => o.value === key)?.label ?? key;
  }

  mesLabel(m: number): string {
    return this.MESES.find(x => x.value === m)?.label ?? String(m);
  }

  get activeFilterChips(): { key: string; label: string }[] {
    const chips: { key: string; label: string }[] = [];
    if (this.dashboardBanco)      chips.push({ key: 'banco',     label: `Banco: ${this.dashboardBanco}` });
    if (this.filterCategoria)     chips.push({ key: 'categoria', label: `Categoría: ${this.filterCategoria}` });
    if (this.filterStatus)        chips.push({ key: 'status',    label: `Estatus: ${this.filterStatusLabel(this.filterStatus)}` });
    if (this.dashboardYear)       chips.push({ key: 'year',      label: `Año: ${this.dashboardYear}` });
    if (this.dashboardMonth)      chips.push({ key: 'month',     label: `Mes: ${this.mesLabel(this.dashboardMonth)}` });
    return chips;
  }

  removeFilterChip(key: string): void {
    switch (key) {
      case 'banco':     this.dashboardBanco  = null; break;
      case 'categoria': this.filterCategoria = null; break;
      case 'status':    this.filterStatus    = '';   break;
      case 'year':      this.dashboardYear = null; this.dashboardMonth = null; this.loadCards(); break;
      case 'month':     this.dashboardMonth = null; this.loadCards(); break;
    }
  }

  hasActiveCardsFilters(): boolean {
    return this.activeFilterChips.length > 0;
  }

  resetCardsFilters(): void {
    this.dashboardBanco  = null;
    this.filterCategoria = null;
    this.filterStatus    = '';
    const hadPeriod = this.dashboardYear != null || this.dashboardMonth != null;
    this.dashboardYear  = null;
    this.dashboardMonth = null;
    if (hadPeriod) this.loadCards();
  }

  onDashboardYearChange(): void {
    if (!this.dashboardYear) this.dashboardMonth = null;
    this.loadCards();
  }

  // ── Buscador global de movimientos (dashboard) ───────────────────────────────
  onGlobalSearchInput(): void {
    this.globalSearch$.next(this.globalSearchTerm);
    if (!this.globalSearchTerm.trim()) { this.globalSearchOpen = false; this.globalSearchResults = []; }
  }

  /** Reabre el dropdown al re-enfocar si ya había resultados cacheados — evita re-consultar. */
  onGlobalSearchFocus(): void {
    if (this.globalSearchTerm.trim() && this.globalSearchResults.length) this.globalSearchOpen = true;
  }

  clearGlobalSearch(): void {
    this.globalSearchTerm      = '';
    this.globalSearchResults   = [];
    this.globalSearchOpen      = false;
    this.globalSearchActiveIdx = -1;
    // Sin este next(''), distinctUntilChanged() se queda con el ÚLTIMO término buscado como
    // "valor anterior" — si la siguiente búsqueda coincide exacto con esa, quedaría bloqueada
    // en silencio (caso de borde, no la causa principal del bug reportado, pero real).
    this.globalSearch$.next('');
  }

  /** Navega al banco del movimiento con ese _id ya enfocado — mismo mecanismo que usa OCR. */
  selectGlobalSearchResult(mov: BankMovement): void {
    this.clearGlobalSearch();
    this.openBank(mov.banco, mov._id);
  }

  onGlobalSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { this.clearGlobalSearch(); return; }
    if (!this.globalSearchOpen || !this.globalSearchResults.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.globalSearchActiveIdx = Math.min(this.globalSearchActiveIdx + 1, this.globalSearchResults.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.globalSearchActiveIdx = Math.max(this.globalSearchActiveIdx - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const mov = this.globalSearchResults[this.globalSearchActiveIdx >= 0 ? this.globalSearchActiveIdx : 0];
      if (mov) this.selectGlobalSearchResult(mov);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClickGlobalSearch(event: MouseEvent): void {
    if (!this.globalSearchOpen) return;
    if (!(event.target as HTMLElement).closest('.global-search-wrap')) this.globalSearchOpen = false;
  }

  /**
   * Arma (o re-arma) la suscripción del buscador global. Reportado 2026-07-30: "a veces se
   * traba, hay que recargar la vista" — el `catchError` de adentro solo protegía la llamada
   * HTTP; cualquier OTRO error en la cadena (lo que sea, incluso uno que no debería pasar)
   * llegaba sin capturar hasta el `.subscribe()` final, que no tenía callback de error — en
   * RxJS eso mata la suscripción COMPLETA para siempre, sin ningún aviso visible. Después de
   * eso, `globalSearch$.next(...)` seguía "hablando" pero ya no había nadie escuchando: el
   * buscador quedaba mudo hasta recargar la página (única forma de crear una suscripción
   * nueva). Ahora: (1) el proyector de switchMap está envuelto en try/catch, para que ningún
   * throw sincrónico se escape antes de llegar a devolver un Observable; (2) se agregó un
   * callback `error` al `.subscribe()` como última red de seguridad — si AÚN así algo se
   * escapa, se loguea a consola (para poder diagnosticar la causa real la próxima vez que
   * pase) y se re-arma la suscripción llamando a este mismo método de nuevo, en vez de dejar
   * el buscador muerto hasta un F5. `takeUntil(this.destroy$)` sigue intacto en cada rearmado,
   * así que igual se limpia bien si el usuario navega fuera de esta vista.
   */
  private _wireGlobalSearch(): void {
    this.globalSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(term => {
        try {
          const q = term.trim();
          if (!q) return of({ data: [] as BankMovement[] });
          this.globalSearchLoading = true;
          return this.bankService.list({ search: q, limit: 8, page: 1 } as BankFilter).pipe(
            catchError(err => {
              console.error('[BanksComponent] buscador global: falló la búsqueda HTTP', err);
              return of({ data: [] as BankMovement[] });
            }),
          );
        } catch (err) {
          console.error('[BanksComponent] buscador global: error sincrónico armando la búsqueda', err);
          return of({ data: [] as BankMovement[] });
        }
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (res) => {
        this.globalSearchLoading  = false;
        this.globalSearchResults  = res.data;
        this.globalSearchActiveIdx = -1;
        this.globalSearchOpen     = this.globalSearchTerm.trim().length > 0;
      },
      error: (err) => {
        console.error('[BanksComponent] buscador global: la suscripción murió, re-armando', err);
        this.globalSearchLoading = false;
        this._wireGlobalSearch();
      },
    });
  }

  // ── Movimientos (vista detalle) ─────────────────────────────────────────────
  movements: BankMovement[] = [];
  pagination = { total: 0, page: 1, limit: 50, pages: 0 };
  loading    = false;

  // ── Filtros activos (detalle) ───────────────────────────────────────────────
  activeStatus:       string = '';
  conceptoFilter:         string = '';
  showConceptoFilter      = false;
  showIdentificadoPorFilter  = false;
  availableIdentificadores:  BankIdentificador[] = [];
  selectedIdentificadores:   string[] = [];   // lista de userIds
  identificadoresLoading     = false;
  showCategoriaFilter  = false;
  availableCategorias: (string | null)[] = [];
  selectedCategorias:  string[] = [];   // '__null__' represents null/sin categoría
  categoriasLoading    = false;
  filterForm: FormGroup;
  sortField: SortField = 'fecha';
  sortDir:   SortDir   = 'desc';
  selectedLimit = 50;
  readonly limitOptions = [50, 100, 200, 500];

  // ── Modal de importación ────────────────────────────────────────────────────
  showImportModal     = false;
  downloadingTemplate = false;

  // ── Modal OCR: cargar comprobantes ──────────────────────────────────────────
  showOcrModal = false;

  // Movimiento focalizado desde OCR (filtra la lista para mostrarlo directamente)
  focusedMovId: string | null = null;

  // ── Panel de Reportes ───────────────────────────────────────────────────────
  showReportPanel             = false;
  reportFechaInicio           = '';
  reportFechaFin              = '';
  reportFechaAplicacionInicio = '';
  reportFechaAplicacionFin    = '';

  // ── Exportar Excel ──────────────────────────────────────────────────────────
  exportingExcel = false;

  // ── Toast de número de autorización ─────────────────────────────────────────
  authToast: { folio: string } | null = null;
  private _authToastTimer: ReturnType<typeof setTimeout> | null = null;

  private showAuthToast(folio: string | null): void {
    if (!folio) return;
    if (this._authToastTimer) clearTimeout(this._authToastTimer);
    this.authToast = { folio };
    this._authToastTimer = setTimeout(() => { this.authToast = null; }, 4500);
  }

  dismissAuthToast(): void {
    if (this._authToastTimer) clearTimeout(this._authToastTimer);
    this.authToast = null;
  }

  // ── Modal de cuenta contable ────────────────────────────────────────────────
  showCuentaModal  = false;
  cuentaModalCard: BankCard | null = null;

  // ── Modal edición de movimiento ──────────────────────────────────────────────
  showEditModal            = false;
  editModalMovement: BankMovement | null = null;

  // ── Modal IDs ERP ────────────────────────────────────────────────────────────
  showErpModal           = false;
  erpModalMovement: BankMovement | null = null;
  // ID del movimiento cuyo dropdown de detalle CxC está abierto en la tabla
  erpDetailMovId: string | null = null;
  erpDetailPos:   { top: number; left: number } | null = null;

  // ── Calendar date-range picker ────────────────────────────────────────────
  @ViewChild('dateRangeBtn') dateRangeBtnRef!: ElementRef<HTMLElement>;
  @ViewChild('erpModal') erpModalRef?: ErpModalComponent;
  @ViewChild('cobroPanel') cobroPanelRef?: CobroPanelComponent;
  showDatePicker    = false;
  calendarContext: 'main' | 'report' | 'report-aplicacion' = 'main';
  calPopupTop       = 0;
  calPopupLeft      = 0;
  calYear           = new Date().getFullYear();
  calMonth          = new Date().getMonth();
  calDaysArr:       { iso: string; day: number; inMonth: boolean }[] = [];
  pickerStart: string | null = null;
  pickerEnd:   string | null = null;
  pickerHover: string | null = null;
  readonly CAL_MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                        'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  readonly CAL_DIAS  = ['Do','Lu','Ma','Mi','Ju','Vi','Sá'];
  // Drag del popup
  private calDragging   = false;
  private calDragMovedPx = 0; // píxeles movidos durante el drag actual
  private calDragOffX   = 0;
  private calDragOffY   = 0;

  // ── Eliminación masiva (solo admin) ─────────────────────────────────────────
  deleteMode         = false;
  selectedForDelete  = new Set<string>();
  showDeleteConfirm  = false;
  deleting           = false;
  deleteError: string | null = null;

  toggleDeleteMode(): void {
    this.deleteMode = !this.deleteMode;
    this.selectedForDelete.clear();
    this.showDeleteConfirm = false;
    this.deleteError       = null;
    if (this.deleteMode) { this.reclasifyMode = false; this.selectedForReclasify.clear(); }
  }

  toggleDeleteSelect(id: string): void {
    if (this.selectedForDelete.has(id)) {
      this.selectedForDelete.delete(id);
    } else {
      this.selectedForDelete.add(id);
    }
  }

  isSelectedForDelete(id: string): boolean {
    return this.selectedForDelete.has(id);
  }

  get allPageSelectedForDelete(): boolean {
    return this.movements.length > 0 && this.movements.every(m => this.selectedForDelete.has(m._id));
  }

  toggleSelectAllForDelete(): void {
    if (this.allPageSelectedForDelete) {
      this.movements.forEach(m => this.selectedForDelete.delete(m._id));
    } else {
      this.movements.forEach(m => this.selectedForDelete.add(m._id));
    }
  }

  confirmDeleteMovements(): void {
    const ids = [...this.selectedForDelete];
    if (ids.length === 0) return;
    this.deleting    = true;
    this.deleteError = null;
    this.bankService.deleteMovements(ids)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.deleting         = false;
          this.showDeleteConfirm = false;
          this.deleteMode        = false;
          this.selectedForDelete.clear();
          this.loadMovements(1);
        },
        error: () => {
          this.deleting    = false;
          this.deleteError = 'Error al eliminar. Intenta de nuevo.';
        },
      });
  }

  // ── Reclasificación masiva (solo admin) ──────────────────────────────────────
  reclasifyMode         = false;
  selectedForReclasify  = new Set<string>();
  showReclasifyConfirm  = false;

  inlineReclasifyId:     string | null                        = null;
  inlineCatPos:          { top: number; left: number } | null = null;
  inlineReclasifySaving: boolean                              = false;
  inlineReclasifyError:  string | null                        = null;

  toggleReclasifyMode(): void {
    this.reclasifyMode = !this.reclasifyMode;
    this.selectedForReclasify.clear();
    this.showReclasifyConfirm = false;
    if (this.reclasifyMode) { this.deleteMode = false; this.selectedForDelete.clear(); }
  }

  canReclasify(m: BankMovement): boolean {
    return m.status !== 'identificado';
  }

  toggleReclasifySelect(id: string): void {
    const m = this.movements.find(mv => mv._id === id);
    if (!m || !this.canReclasify(m)) return;
    if (this.selectedForReclasify.has(id)) {
      this.selectedForReclasify.delete(id);
    } else {
      this.selectedForReclasify.add(id);
    }
  }

  isSelectedForReclasify(id: string): boolean {
    return this.selectedForReclasify.has(id);
  }

  get selectedForReclasifyIds(): string[] {
    return [...this.selectedForReclasify];
  }

  get allPageSelectedForReclasify(): boolean {
    const elegibles = this.movements.filter(m => this.canReclasify(m));
    return elegibles.length > 0 && elegibles.every(m => this.selectedForReclasify.has(m._id));
  }

  toggleSelectAllForReclasify(): void {
    const elegibles = this.movements.filter(m => this.canReclasify(m));
    if (elegibles.every(m => this.selectedForReclasify.has(m._id))) {
      elegibles.forEach(m => this.selectedForReclasify.delete(m._id));
    } else {
      elegibles.forEach(m => this.selectedForReclasify.add(m._id));
    }
  }

  onBulkReclasifySaved(result: { mode: 'status' | 'categoria'; count: number }): void {
    this.showReclasifyConfirm = false;
    this.reclasifyMode        = false;
    this.selectedForReclasify.clear();
    this.loadMovements(1);
  }

  // ── Modal saldo inicial ──────────────────────────────────────────────────────
  showSaldoInicialModal = false;

  get showSaldoCol(): boolean {
    return this.activeCard?.saldoInicial != null;
  }

  openSaldoInicialModal(): void { this.showSaldoInicialModal = true; }
  closeSaldoInicialModal(): void { this.showSaldoInicialModal = false; }

  onSaldoInicialSaved(res: { saldoInicial: number; saldoInicialFechaCorte: string | null }): void {
    const card = this.bankCards.find(c => c.banco === this.activeBanco);
    if (card) {
      card.saldoInicial           = res.saldoInicial;
      card.saldoInicialFechaCorte = res.saldoInicialFechaCorte;
    }
    this.showSaldoInicialModal = false;
    this.loadMovements(this.pagination.page);
  }

  // ── Panel de reglas de categorización ────────────────────────────────────────
  showRulesPanel = false;

  private isoFirstDay(year: number, month: number): string {
    const mm = String(month).padStart(2, '0');
    return `${year}-${mm}-01T00:00:00Z`;
  }

  private isoLastDay(year: number, month: number): string {
    const lastDay = new Date(year, month, 0).getDate();
    const mm      = String(month).padStart(2, '0');
    const dd      = String(lastDay).padStart(2, '0');
    return `${year}-${mm}-${dd}T23:59:59Z`;
  }

  // ── Catálogos ───────────────────────────────────────────────────────────────
  readonly bancos = ['BBVA', 'Banamex', 'Santander', 'Azteca'];

  readonly bancoAccent: Record<string, string> = {
    BBVA:      '#004B93',
    Banamex:   '#B22222',
    Santander: '#EC0000',
    Azteca:    '#E65A00',
  };

  readonly bancoLight: Record<string, string> = {
    BBVA:      '#EBF2FA',
    Banamex:   '#FDF0F0',
    Santander: '#FFF0F0',
    Azteca:    '#FFF3EB',
  };

  /** Bancos fuera de `bancoAccent`/`bancoLight` (hay 15 soportados en total) caen a un tono neutro. */
  bancoPillBg(banco: string):    string { return this.bancoLight[banco]  ?? 'var(--gray-100)'; }
  bancoPillColor(banco: string): string { return this.bancoAccent[banco] ?? 'var(--gray-600)'; }

  readonly categoriaColors: Record<string, { bg: string; color: string }> = {
    'Transferencia':     { bg: '#ede9fe', color: '#6d28d9' },
    'Nómina':            { bg: '#dbeafe', color: '#1d4ed8' },
    'Depósito efectivo': { bg: '#dcfce7', color: '#15803d' },
    'Cheque':            { bg: '#fef9c3', color: '#92400e' },
    'Retiro ATM':        { bg: '#fee2e2', color: '#b91c1c' },
    'Cargo bancario':    { bg: '#f1f5f9', color: '#475569' },
    'Pago de servicio':  { bg: '#f0fdfa', color: '#0f766e' },
    'Cobro tarjeta':     { bg: '#fff7ed', color: '#c2410c' },
    'Traspaso':          { bg: '#faf5ff', color: '#7e22ce' },
  };

  private destroy$        = new Subject<void>();
  private loadTrigger$    = new Subject<BankFilter>();
  private conceptoFilter$ = new Subject<string>();
  private cardsLoadTrigger$ = new Subject<void>();

  // ── "Volver" desde una navegación puntual (ej. desde "ver movimientos" de una
  // póliza de Traspasos, ver poliza-traspasos.component.ts#irABanco) — vía
  // queryParams `volverA`/`volverPolizaId`, no un `location.back()` genérico
  // (el usuario puede haber navegado con varios pasos intermedios). Solo
  // soporta el origen 'traspasos' por ahora; se extiende agregando otro `case`
  // si aparece un segundo origen.
  volverA:         string | null = null;
  volverPolizaId:  string | null = null;

  constructor(
    private bankService:   BankService,
    private fb:            FormBuilder,
    public  auth:          AuthService,
    private socketService: SocketService,
    private cdr:           ChangeDetectorRef,
    private route:         ActivatedRoute,
    private router:        Router,
  ) {
    this.filterForm = this.fb.group({
      search:      [''],
      tipo:        [''],
      fechaInicio: [''],
      fechaFin:    [''],
    });
  }

  // ── Getters ─────────────────────────────────────────────────────────────────

  get activeCard(): BankCard | null {
    if (!this.activeBanco) return null;
    return this.bankCards.find(c => c.banco === this.activeBanco) ?? null;
  }

  /** Suma sobre los bancos ya filtrados, para que el pie de la tabla siempre coincida con lo visible. */
  get totalSaldoPendiente(): number {
    return this.bankCardsForKpi.reduce((sum, c) => sum + (this.cardStats(c).saldoPendiente ?? 0), 0);
  }

  // ── Visibilidad de columnas (se ocultan cuando el filtro las hace redundantes) ─
  get showDepositoCol(): boolean { return this.filterForm.get('tipo')!.value !== 'retiro'; }
  get showRetiroCol():   boolean {
    return this.filterForm.get('tipo')!.value !== 'deposito' && !this.auth.hasRole('cobranza');
  }
  get showSaldoActualizadoCol(): boolean {
    return !this.auth.hasRole('cobranza');
  }
  get showStatusCol():   boolean { return !this.activeStatus; }
  get showIdentificadoPorCol(): boolean { return true; }

  // ── Ciclo de vida ───────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadTrigger$.pipe(
      switchMap(filters => this.bankService.list(filters)),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (res) => {
        this.movements  = res.data;
        this.pagination = res.pagination;
        this.loading    = false;
      },
      error: () => { this.loading = false; },
    });

    // switchMap cancela la carga anterior si el usuario cambia año/mes rápido — sin esto,
    // una respuesta vieja podía llegar después de una nueva y sobreescribirla (condición de carrera).
    this.cardsLoadTrigger$.pipe(
      switchMap(() => this.bankService.cards(this.dashboardYear, this.dashboardMonth)),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (cards) => {
        this.bankCards    = cards;
        this.cardsLoading = false;
        // Un filtro de categoría que ya no existe para el banco/periodo recién cargado
        // dejaría la tabla vacía sin que el usuario entienda por qué.
        if (this.filterCategoria && !this.categoriasDisponibles.some(c => c.categoria === this.filterCategoria)) {
          this.filterCategoria = null;
        }
      },
      error: () => { this.cardsLoading = false; },
    });

    this.loadCards();

    // Buscador global de movimientos (dashboard): debounce + switchMap cancela la búsqueda
    // anterior si el usuario sigue tecleando — mismo patrón que el buscador de la vista
    // detalle (línea de abajo). limit:8 mantiene el dropdown corto y legible; sin `banco`
    // busca en TODOS los bancos, reusando el scoring que ya prioriza importe en el backend.
    this._wireGlobalSearch();

    this.filterForm.get('search')!.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadMovements(1));

    this.conceptoFilter$.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadMovements(1));

    merge(
      this.filterForm.get('tipo')!.valueChanges,
      this.filterForm.get('fechaInicio')!.valueChanges,
      this.filterForm.get('fechaFin')!.valueChanges,
    ).pipe(
      debounceTime(0),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadMovements(1));

    // ── Sockets: actualizaciones en tiempo real ──────────────────────────────
    this.socketService.movementUpdated$.pipe(takeUntil(this.destroy$)).subscribe(updated => {
      const idx = this.movements.findIndex(m => m._id === updated._id);
      if (idx !== -1) {
        // Si la regla ahora oculta este movimiento para mi rol (y no soy admin), sacarlo
        // de la vista en tiempo real — sin este chequeo la fila queda mergeada in-place
        // y solo un refresh completo vuelve a aplicar el filtro de ocultoRoles del backend.
        const ocultoParaMi = !!updated.ocultoRoles?.includes(this.auth.currentUser.role)
          && !this.auth.hasPermission('banks:admin');
        if (ocultoParaMi) {
          this.movements = this.movements.filter(m => m._id !== updated._id);
          return;
        }

        const prev = this.movements[idx];
        this.movements[idx] = { ...prev, ...updated } as unknown as BankMovement;
        this.movements = [...this.movements];
        if (updated.status === 'identificado' && prev.status !== 'identificado') {
          this.showAuthToast(this.movements[idx].folio);
        }
      }
      // Si el modal de ERP está abierto con este movimiento, actualizar sus datos también
      if (this.erpModalMovement?._id === updated._id) {
        this.erpModalMovement = { ...this.erpModalMovement, ...updated } as unknown as BankMovement;
      }
    });

    // Deep-link puntual: llegada desde "ver movimientos" de una póliza de
    // Traspasos (ver poliza-traspasos.component.ts#irABanco) con el banco y
    // movimiento ya resueltos — abre directo el detalle enfocado.
    const qp = this.route.snapshot.queryParamMap;
    const banco = qp.get('banco');
    const movId = qp.get('movId');
    if (banco && movId) {
      this.volverA        = qp.get('volverA');
      this.volverPolizaId = qp.get('volverPolizaId');
      this.openBank(banco, movId);
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }

  /** Vuelve específicamente a la póliza que se estaba consultando antes de navegar
   *  acá (no un `location.back()` genérico) — ver `volverA`/`volverPolizaId`. */
  volver(): void {
    if (this.volverA === 'traspasos' && this.volverPolizaId) {
      this.router.navigate(['/polizas/traspasos-cp'], { queryParams: { openPoliza: this.volverPolizaId } });
    }
  }

  ngAfterViewInit(): void {
    // @ViewChild('erpModal') erpModalRef comienza undefined y resuelve aquí.
    // detectChanges evita NG0100 en el binding [erpModal]="erpModalRef".
    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this._authToastTimer) clearTimeout(this._authToastTimer);
  }

  // ── Navegación ──────────────────────────────────────────────────────────────

  openBank(banco: string, focusedMovId?: string): void {
    if (this.activeBanco && this.activeBanco !== banco) {
      this.socketService.leaveBanco(this.activeBanco);
    }
    this.activeBanco        = banco;
    this.view               = 'detail';
    this.activeStatus       = '';
    this.conceptoFilter              = '';
    this.selectedIdentificadores     = [];
    this.availableIdentificadores    = [];
    this.selectedCategorias          = [];
    this.availableCategorias         = [];
    this.showConceptoFilter          = false;
    this.showIdentificadoPorFilter   = false;
    this.showCategoriaFilter         = false;
    this.showRulesPanel      = false;
    this.focusedMovId        = focusedMovId ?? null;
    this.filterForm.reset({ search: '', tipo: '', fechaInicio: '', fechaFin: '' });
    this.socketService.joinBanco(banco);
    this.loadMovements(1);
  }

  goBack(): void {
    if (this.activeBanco) this.socketService.leaveBanco(this.activeBanco);
    this.view         = 'cards';
    this.activeBanco  = null;
    this.movements    = [];
    this.focusedMovId = null;
  }

  clearFocusedMovement(): void {
    this.focusedMovId = null;
    this.loadMovements(1);
  }

  // ── Carga de datos ──────────────────────────────────────────────────────────

  loadCards(): void {
    this.cardsLoading = true;
    this.cardsLoadTrigger$.next();
    // El catálogo de años no depende del año/mes activos, pero SÍ del banco — se trae una sola
    // vez mientras no haya banco filtrado; onBancoFilterChange() lo vuelve a pedir si cambia.
    if (this.availableYears.length === 0) this.loadAvailableYears();
  }

  /** Puebla el filtro de año, acotado al banco activo (si hay uno) para no ofrecer años sin
   *  datos para ese banco. Endpoint liviano — 2026-07-31, ver bank.service.ts#years(). */
  private loadAvailableYears(): void {
    this.bankService.years(this.dashboardBanco).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => { this.availableYears = res.years; },
      error: () => {},
    });
  }

  /** El filtro de banco es client-side (no recarga las tarjetas) — pero sí debe refrescar el
   *  combo de años (acotarlo al banco) y puede invalidar la categoría activa. */
  onBancoFilterChange(): void {
    this.loadAvailableYears();
    if (this.filterCategoria && !this.categoriasDisponibles.some(c => c.categoria === this.filterCategoria)) {
      this.filterCategoria = null;
    }
  }

  loadMovements(page = 1): void {
    this.loading = true;
    const { search, tipo, fechaInicio, fechaFin } = this.filterForm.value;

    const filters: BankFilter = {
      page,
      limit:       this.selectedLimit,
      banco:       this.activeBanco     || undefined,
      search:      search               || undefined,
      tipo:        tipo                 || undefined,
      fechaInicio: fechaInicio          || undefined,
      fechaFin:    fechaFin             || undefined,
      status:      this.activeStatus    || undefined,
      concepto:         this.conceptoFilter              || undefined,
      identificadoPor:  this.selectedIdentificadores.length ? this.selectedIdentificadores.join(',') : undefined,
      categorias:       this.selectedCategorias.length ? this.selectedCategorias.join(',') : undefined,
      sortBy:      this.sortField,
      sortDir:     this.sortDir,
      movId:       this.focusedMovId    || undefined,
    };

    this.loadTrigger$.next(filters);
  }

  // ── Filtros ─────────────────────────────────────────────────────────────────

  hasActiveFilters(): boolean {
    const v = this.filterForm.value;
    return !!(v.search || v.tipo || v.fechaInicio || v.fechaFin
              || this.activeStatus || this.conceptoFilter || this.selectedIdentificadores.length || this.selectedCategorias.length);
  }

  clearFilters(): void {
    this.activeStatus              = '';
    this.conceptoFilter            = '';
    this.selectedIdentificadores   = [];
    this.selectedCategorias        = [];
    this.filterForm.reset({ search: '', tipo: '', fechaInicio: '', fechaFin: '' });
    this.conceptoFilter$.next('');
    this.pickerStart = null;
    this.pickerEnd   = null;
  }

  onConceptoFilterChange(): void {
    this.conceptoFilter$.next(this.conceptoFilter);
  }

  openIdentificadorFilter(): void {
    this.showIdentificadoPorFilter = !this.showIdentificadoPorFilter;
    if (this.showIdentificadoPorFilter && this.availableIdentificadores.length === 0) {
      this.loadAvailableIdentificadores();
    }
  }

  loadAvailableIdentificadores(): void {
    if (!this.activeBanco) return;
    this.identificadoresLoading = true;
    this.bankService.listIdentificadores(this.activeBanco).pipe(takeUntil(this.destroy$)).subscribe({
      next: (ids) => { this.availableIdentificadores = ids; this.identificadoresLoading = false; },
      error: ()   => { this.identificadoresLoading = false; },
    });
  }

  isIdentificadorSelected(userId: string): boolean {
    return this.selectedIdentificadores.includes(userId);
  }

  toggleIdentificador(userId: string): void {
    const idx = this.selectedIdentificadores.indexOf(userId);
    if (idx >= 0) {
      this.selectedIdentificadores.splice(idx, 1);
    } else {
      this.selectedIdentificadores.push(userId);
    }
    this.loadMovements(1);
  }

  clearIdentificadorFilter(): void {
    this.selectedIdentificadores = [];
    this.loadMovements(1);
  }

  get allIdentificadoresSelected(): boolean {
    return this.selectedIdentificadores.length === 0;
  }

  openCategoriaFilter(): void {
    this.showCategoriaFilter = !this.showCategoriaFilter;
    if (this.showCategoriaFilter && this.availableCategorias.length === 0) {
      this.loadAvailableCategorias();
    }
  }

  loadAvailableCategorias(): void {
    if (!this.activeBanco) return;
    this.categoriasLoading = true;
    this.bankService.listCategories(this.activeBanco).pipe(takeUntil(this.destroy$)).subscribe({
      next: (cats) => { this.availableCategorias = cats; this.categoriasLoading = false; },
      error: ()    => { this.categoriasLoading = false; },
    });
  }

  isCategoriaSelected(cat: string | null): boolean {
    return this.selectedCategorias.includes(cat === null ? '__null__' : cat);
  }

  toggleCategoria(cat: string | null): void {
    const key = cat === null ? '__null__' : cat;
    const idx = this.selectedCategorias.indexOf(key);
    if (idx >= 0) {
      this.selectedCategorias.splice(idx, 1);
    } else {
      this.selectedCategorias.push(key);
    }
    this.loadMovements(1);
  }

  clearCategoriaFilter(): void {
    this.selectedCategorias = [];
    this.loadMovements(1);
  }

  get allCategoriaSelected(): boolean {
    return this.selectedCategorias.length === 0;
  }

  // ── Ordenamiento ────────────────────────────────────────────────────────────

  sort(field: SortField): void {
    this.sortDir   = this.sortField === field && this.sortDir === 'asc' ? 'desc' : 'asc';
    this.sortField = field;
    this.loadMovements(1);
  }

  sortIcon(field: SortField): string {
    if (this.sortField !== field) return '↕';
    return this.sortDir === 'asc' ? '↑' : '↓';
  }

  isActiveSort(f: SortField): boolean { return this.sortField === f; }

  // ── Recencia ────────────────────────────────────────────────────────────────

  formatRecency(dateStr: string | null): string {
    if (!dateStr) return 'Sin datos';
    const d    = new Date(dateStr);
    const now  = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diff === 0) {
      const hh = d.getHours().toString().padStart(2, '0');
      const mm = d.getMinutes().toString().padStart(2, '0');
      return `Hoy, ${hh}:${mm}`;
    }
    if (diff === 1) return 'Ayer';
    if (diff < 7)  return `Hace ${diff} días`;
    if (diff < 30) return `Hace ${Math.floor(diff / 7)} sem.`;
    return `Hace ${Math.floor(diff / 30)} mes${Math.floor(diff / 30) > 1 ? 'es' : ''}`;
  }

  recencyClass(dateStr: string | null): string {
    if (!dateStr) return 'dot-gray';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (diff === 0) return 'dot-green';
    if (diff < 7)  return 'dot-amber';
    return 'dot-gray';
  }


  // ── Modal de importación ────────────────────────────────────────────────────

  openImportModal(): void { this.showImportModal = true; }
  closeImportModal(): void { this.showImportModal = false; }

  downloadTemplate(): void {
    if (this.downloadingTemplate) return;
    this.downloadingTemplate = true;
    this.bankService.downloadTemplate().pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url; a.download = 'plantilla-bancos.xlsx'; a.click();
        URL.revokeObjectURL(url);
        this.downloadingTemplate = false;
      },
      error: () => { this.downloadingTemplate = false; },
    });
  }

  onImportComplete(): void {
    this.loadCards();
    if (this.view === 'detail') this.loadMovements(1);
  }

  // ── Modal OCR ────────────────────────────────────────────────────────────────

  openOcrModal(): void { this.showOcrModal = true; }
  closeOcrModal(): void { this.showOcrModal = false; }

  onCandidateSelected(e: { banco: string; movId: string }): void {
    this.showOcrModal = false;
    if (this.view === 'detail' && this.activeBanco === e.banco) {
      this.focusedMovId = e.movId;
      this.loadMovements(1);
    } else {
      this.openBank(e.banco, e.movId);
    }
  }



  // ── Modal de cuenta contable ────────────────────────────────────────────────

  openCuentaModal(card: BankCard, event: Event): void {
    event.stopPropagation();
    this.cuentaModalCard = card;
    this.showCuentaModal = true;
  }

  closeCuentaModal(): void {
    this.showCuentaModal = false;
    this.cuentaModalCard = null;
  }

  onBancoConfigSaved(cfg: { cuentaContable: string | null; numeroCuenta: string | null }): void {
    const card = this.bankCards.find(c => c.banco === this.cuentaModalCard!.banco);
    if (card) {
      card.cuentaContable = cfg.cuentaContable;
      card.numeroCuenta   = cfg.numeroCuenta;
    }
    this.showCuentaModal = false;
    this.cuentaModalCard = null;
  }

  // ── Modal UUID CFDI ─────────────────────────────────────────────────────────

  // ── Edición de movimiento ─────────────────────────────────────────────────

  openEditModal(mov: BankMovement, event: Event): void {
    event.stopPropagation();
    this.closeInlineReclasify();
    this.editModalMovement = mov;
    this.showEditModal     = true;
  }

  closeEditModal(): void {
    this.showEditModal     = false;
    this.editModalMovement = null;
  }

  onMovementSaved(updated: BankMovement): void {
    const idx = this.movements.findIndex(m => m._id === updated._id);
    if (idx !== -1) {
      const { _id, banco, ...fields } = updated;
      this.movements[idx] = { ...this.movements[idx], ...fields } as BankMovement;
    }
    this.showEditModal     = false;
    this.editModalMovement = null;
  }

  openInlineReclasify(mov: BankMovement, event: Event): void {
    event.stopPropagation();
    if (this.inlineReclasifyId === mov._id) { this.closeInlineReclasify(); return; }
    const rect             = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.inlineCatPos      = { top: rect.bottom + 4, left: rect.left };
    this.inlineReclasifyId = mov._id;
    this.inlineReclasifyError  = null;
    this.inlineReclasifySaving = false;
    if (this.availableCategorias.length === 0) this.loadAvailableCategorias();
  }

  closeInlineReclasify(): void {
    if (this.inlineReclasifySaving) return;
    this.inlineReclasifyId    = null;
    this.inlineCatPos         = null;
    this.inlineReclasifyError = null;
  }

  saveInlineReclasify(mov: BankMovement, value: string | null): void {
    if (this.inlineReclasifySaving) return;
    if (value === (mov.categoria ?? null)) { this.closeInlineReclasify(); return; }

    this.inlineReclasifySaving = true;
    this.inlineReclasifyError  = null;
    this.bankService.updateCategoria(mov._id, value)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          const idx = this.movements.findIndex(m => m._id === mov._id);
          if (idx !== -1) {
            this.movements[idx] = { ...this.movements[idx], categoria: result.categoria, status: result.status };
          }
          this.inlineReclasifySaving = false;
          this.closeInlineReclasify();
        },
        error: (err) => {
          this.inlineReclasifyError  = err?.error?.error ?? 'Error al guardar';
          this.inlineReclasifySaving = false;
        },
      });
  }

  // ── IDs ERP ─────────────────────────────────────────────────────────────────

  openErpModal(mov: BankMovement, event: Event): void {
    event.stopPropagation();
    if (this.isLockedByOther(mov)) return;
    this.erpModalMovement = mov;
    this.showErpModal     = true;
    // Child ErpModalComponent initializes itself via ngOnInit
  }

  onErpModalClosed(): void {
    this.showErpModal     = false;
    this.erpModalMovement = null;
  }

  onErpSaved(e: { folio: string; hasErpIds: boolean }): void {
    this.loadCards();
    if (e.hasErpIds) this.showAuthToast(e.folio);
    this.showErpModal     = false;
    this.erpModalMovement = null;
  }

  onErpCloseCobroPanel(): void {
    this.cobroPanelRef?.closePanel();
  }

  onErpMovementUpdated(mov: BankMovement): void {
    this.erpModalMovement = mov;
    const idx = this.movements.findIndex(m => m._id === mov._id);
    if (idx !== -1) this.movements[idx] = { ...this.movements[idx], ...mov };
  }

  // ── Calendar date-range picker ────────────────────────────────────────────

  get calMonthLabel(): string {
    return `${this.CAL_MESES[this.calMonth]} ${this.calYear}`;
  }

  get dateRangeLabel(): string {
    const fi = this.filterForm.value.fechaInicio as string;
    const ff = this.filterForm.value.fechaFin   as string;
    if (!fi && !ff) return 'Rango de fechas';
    const fmt = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
    if (fi && ff) return `${fmt(fi)} – ${fmt(ff)}`;
    return fi ? `Desde ${fmt(fi)}` : `Hasta ${fmt(ff)}`;
  }

  openDatePicker(event: Event, context: 'main' | 'report' | 'report-aplicacion' = 'main', el?: HTMLElement): void {
    event.stopPropagation();
    this.calendarContext = context;
    // Posicionar el popup respecto al viewport del botón (position:fixed escapa
    // cualquier contenedor con overflow:hidden o overflow:auto)
    const btn  = el ?? this.dateRangeBtnRef.nativeElement;
    const rect = btn.getBoundingClientRect();
    this.calPopupTop  = rect.bottom + 6;
    this.calPopupLeft = rect.left;

    const fi = context === 'report'            ? this.reportFechaInicio
             : context === 'report-aplicacion' ? this.reportFechaAplicacionInicio
             : (this.filterForm.value.fechaInicio as string);
    if (fi) {
      const d = new Date(fi + 'T12:00:00');
      this.calYear  = d.getFullYear();
      this.calMonth = d.getMonth();
    } else {
      const now = new Date();
      this.calYear  = now.getFullYear();
      this.calMonth = now.getMonth();
    }
    if (context === 'report') {
      this.pickerStart = this.reportFechaInicio || null;
      this.pickerEnd   = this.reportFechaFin   || null;
    } else if (context === 'report-aplicacion') {
      this.pickerStart = this.reportFechaAplicacionInicio || null;
      this.pickerEnd   = this.reportFechaAplicacionFin   || null;
    } else {
      this.pickerStart = (this.filterForm.value.fechaInicio as string) || null;
      this.pickerEnd   = (this.filterForm.value.fechaFin   as string) || null;
    }
    this.pickerHover = null;
    this.buildCalDays();
    this.showDatePicker = !this.showDatePicker;
  }

  buildCalDays(): void {
    const arr: { iso: string; day: number; inMonth: boolean }[] = [];
    const firstDow = new Date(this.calYear, this.calMonth, 1).getDay();
    for (let i = firstDow - 1; i >= 0; i--) {
      const d = new Date(this.calYear, this.calMonth, -i);
      arr.push({ iso: this.isoDate(d), day: d.getDate(), inMonth: false });
    }
    const lastDay = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      arr.push({ iso: this.isoDate(new Date(this.calYear, this.calMonth, d)), day: d, inMonth: true });
    }
    const trailing = 42 - arr.length;
    for (let d = 1; d <= trailing; d++) {
      arr.push({ iso: this.isoDate(new Date(this.calYear, this.calMonth + 1, d)), day: d, inMonth: false });
    }
    this.calDaysArr = arr;
  }

  private isoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  calPrev(): void {
    if (this.calMonth === 0) { this.calYear--; this.calMonth = 11; }
    else { this.calMonth--; }
    this.buildCalDays();
  }

  calNext(): void {
    if (this.calMonth === 11) { this.calYear++; this.calMonth = 0; }
    else { this.calMonth++; }
    this.buildCalDays();
  }

  onCalClick(iso: string): void {
    if (!this.pickerStart || this.pickerEnd) {
      this.pickerStart = iso;
      this.pickerEnd   = null;
      this.pickerHover = null;
    } else {
      const [s, e] = iso >= this.pickerStart
        ? [this.pickerStart, iso]
        : [iso, this.pickerStart];
      this.pickerStart = s;
      this.pickerEnd   = e;
      this.pickerHover = null;
      if (this.calendarContext === 'report') {
        this.reportFechaInicio = s;
        this.reportFechaFin    = e;
      } else if (this.calendarContext === 'report-aplicacion') {
        this.reportFechaAplicacionInicio = s;
        this.reportFechaAplicacionFin    = e;
      } else {
        this.filterForm.patchValue({ fechaInicio: s, fechaFin: e });
      }
      this.showDatePicker = false;
      // loadMovements se dispara por la suscripción a filterForm.valueChanges
    }
  }

  onCalHover(iso: string): void {
    if (this.pickerStart && !this.pickerEnd) this.pickerHover = iso;
  }

  /** Devuelve [start, end] efectivos considerando hover para preview visual. */
  private calRange(): [string | null, string | null] {
    if (this.pickerEnd) return [this.pickerStart, this.pickerEnd];
    if (this.pickerStart && this.pickerHover) {
      return this.pickerStart <= this.pickerHover
        ? [this.pickerStart, this.pickerHover]
        : [this.pickerHover, this.pickerStart];
    }
    return [this.pickerStart, null];
  }

  isDayStart(iso: string): boolean  { return iso === this.calRange()[0]; }
  isDayEnd(iso: string): boolean    { return iso === this.calRange()[1]; }
  isDayInRange(iso: string): boolean {
    const [s, e] = this.calRange();
    return !!(s && e && iso > s && iso < e);
  }
  isDayToday(iso: string): boolean {
    return iso === this.isoDate(new Date());
  }

  clearDateRange(event?: Event): void {
    event?.stopPropagation();
    this.pickerStart = null;
    this.pickerEnd   = null;
    if (this.calendarContext === 'report') {
      this.reportFechaInicio = '';
      this.reportFechaFin    = '';
    } else if (this.calendarContext === 'report-aplicacion') {
      this.reportFechaAplicacionInicio = '';
      this.reportFechaAplicacionFin    = '';
    } else {
      this.filterForm.patchValue({ fechaInicio: '', fechaFin: '' });
    }
    this.showDatePicker = false;
  }

  removeErpId(mov: BankMovement, erpId: string, event: Event): void {
    event.stopPropagation();
    if (this.isLockedByOther(mov)) return;
    this.bankService.removeErpId(mov._id, erpId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        mov.erpIds          = res.erpIds;
        mov.erpLinks        = res.erpLinks;
        mov.saldoErp        = res.saldoErp;
        mov.uuidXML         = res.uuidXML;
        mov.status          = res.status;
        mov.identificadoPor = res.identificadoPor ?? [];
        this.loadCards();
      },
    });
  }

  erpDiferencia(m: BankMovement): number | null {
    if (m.saldoErp == null || !m.erpLinks?.length) return null;
    return (m.deposito ?? m.retiro ?? 0) - m.saldoErp;
  }

  // Única fuente de verdad para "¿el saldo ERP cuadra con el depósito?" —
  // usada tanto para bloquear el renglón como para el pill de estado.
  erpCuadra(m: BankMovement): boolean {
    const dif = this.erpDiferencia(m);
    return dif !== null && Math.abs(dif) <= 1.0;
  }

  // 2026-08-20 (pedido explícito del usuario, ajustado el mismo día): cuando
  // la CxC vinculada EXCEDE al depósito más allá de la tolerancia de
  // centavos ($1) — un pago parcial real, no un simple redondeo — la columna
  // Diferencia se muestra como "identificado" (ícono + 0.00) en vez del
  // número real, porque algunos usuarios no entendían por qué había
  // "diferencia" ahí. A PROPÓSITO NO cubre la zona de tolerancia
  // (-1.0 <= dif <= 1.0, la misma de erpCuadra()): un caso como depósito 627
  // / CxC 626.43 (dif 0.57, diferencia real a centavos) SÍ debe seguir
  // mostrando el monto real en verde — el usuario pidió explícitamente que
  // esos casos NO lleven el ícono, ya se entienden como identificados sin él.
  // Solo el depósito excediendo la CxC (dif > 1.0) sigue con el monto real
  // en ámbar (dif-pos), igual que siempre. NO cambia erpCuadra() (bloqueo de
  // renglón/pill de estado) — es un concepto distinto, solo afecta esta
  // columna.
  erpDiferenciaCuadrada(m: BankMovement): boolean {
    const dif = this.erpDiferencia(m);
    return dif !== null && dif < -1.0;
  }

  // ── Status inline ───────────────────────────────────────────────────────────

  isLockedByOther(mov: BankMovement): boolean {
    // 2026-08-05: quien tiene banks:erp:unlink puede desvincular cualquier CxC, sin importar
    // quién identificó el movimiento — mismo criterio que ya tenía admin (ver bank.service.js
    // setErpIds/updateErpIds, mismo día). Este candado ya no aplica para ese permiso.
    if (this.auth.hasRole('admin') || this.auth.hasPermission('banks:erp:unlink')) return false;
    const entries = mov.identificadoPor ?? [];
    return (
      mov.status === 'identificado' &&
      entries.length > 0 &&
      !entries.some(e => e.userId === this.auth.currentUser.id)
    );
  }

  cycleStatus(mov: BankMovement): void {
    if (!this.auth.hasRole('admin')) return;

    const tieneErpIds = (mov.erpIds?.length ?? 0) > 0;

    const order: BankStatus[] = ['no_identificado', 'identificado', 'otros'];
    let next = order[(order.indexOf(mov.status) + 1) % order.length];
    if (next === 'identificado' && !tieneErpIds) {
      next = order[(order.indexOf(next) + 1) % order.length];
    }
    this.bankService.updateStatus(mov._id, next).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        mov.status          = res.status;
        mov.identificadoPor = res.identificadoPor ?? [];
        this.loadCards();
        if (res.status === 'identificado') this.showAuthToast(mov.folio);
      },
    });
  }

  canUnlinkErp(mov: BankMovement): boolean {
    if (this.auth.hasRole('admin')) return true;
    const entries = mov.identificadoPor ?? [];
    // Si el movimiento tiene CxC vinculadas (o está identificado), solo el usuario
    // que participó en la identificación puede desvincular
    const hasLinks = (mov.erpIds?.length ?? 0) > 0;
    if (hasLinks || mov.status === 'identificado') {
      return entries.some(e => e.userId === this.auth.currentUser.id);
    }
    return true;
  }

  // ── Métodos del panel de Reportes ─────────────────────────────────────────

  openReportPanel(): void {
    this.reportFechaInicio          = '';
    this.reportFechaFin             = '';
    this.reportFechaAplicacionInicio = '';
    this.reportFechaAplicacionFin    = '';
    this.showReportPanel = true;
  }

  closeReportPanel(): void { this.showReportPanel = false; }

  onReportCalendarOpen(e: { context: 'report' | 'report-aplicacion'; anchor: HTMLElement }): void {
    this.openDatePicker({ stopPropagation: () => {} } as Event, e.context, e.anchor);
  }

  exportExcel(): void {
    if (this.exportingExcel) return;
    this.exportingExcel = true;
    const { search, tipo, fechaInicio, fechaFin } = this.filterForm.value;
    const filters: BankFilter = {
      banco:       this.activeBanco     || undefined,
      search:      search               || undefined,
      tipo:        tipo                 || undefined,
      fechaInicio: fechaInicio          || undefined,
      fechaFin:    fechaFin             || undefined,
      status:          this.activeStatus           || undefined,
      concepto:        this.conceptoFilter              || undefined,
      identificadoPor: this.selectedIdentificadores.length ? this.selectedIdentificadores.join(',') : undefined,
      categorias:      this.selectedCategorias.length ? this.selectedCategorias.join(',') : undefined,
      sortBy:          this.sortField,
      sortDir:         this.sortDir,
    };
    this.bankService.exportMovements(filters).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const banco = this.activeBanco || 'movimientos';
        const fecha = new Date().toISOString().slice(0, 10);
        a.href     = url;
        a.download = `movimientos-${banco}-${fecha}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportingExcel = false;
      },
      error: () => { this.exportingExcel = false; },
    });
  }

  // ── Popover de historial de vinculación ─────────────────────────────────────
  historialPopoverId: string | null = null;
  historialPos: { bottom: number; right: number } | null = null;

  @HostListener('document:click')
  onDocumentClick(): void {
    // Si el usuario arrastró el calendario, suprimir el click que dispara mouseup→click
    if (this.calDragMovedPx > 4) { this.calDragMovedPx = 0; return; }
    this.historialPopoverId     = null;
    this.historialPos           = null;
    this.erpDetailMovId         = null;
    this.erpDetailPos           = null;
    this.categoriasPopoverBanco = null;
    this.categoriasPopoverPos   = null;
    this.showDatePicker         = false;
    this.closeInlineReclasify();
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent): void {
    if (!this.calDragging) return;
    const newLeft = event.clientX - this.calDragOffX;
    const newTop  = event.clientY - this.calDragOffY;
    // Mantener el popup dentro del viewport
    this.calPopupLeft = Math.max(0, Math.min(newLeft, window.innerWidth  - 260));
    this.calPopupTop  = Math.max(0, Math.min(newTop,  window.innerHeight - 100));
    this.calDragMovedPx += Math.abs(event.movementX) + Math.abs(event.movementY);
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp(): void {
    this.calDragging = false;
  }

  onCalDragStart(event: MouseEvent): void {
    if (event.button !== 0) return;
    this.calDragging    = true;
    this.calDragMovedPx = 0;
    this.calDragOffX    = event.clientX - this.calPopupLeft;
    this.calDragOffY    = event.clientY - this.calPopupTop;
    event.preventDefault(); // evita selección de texto durante el drag
    event.stopPropagation();
  }

  /** Abre/cierra el dropdown de detalle de CxC en la columna IDS ERP. */
  toggleErpDetail(movId: string, event: Event): void {
    event.stopPropagation();
    if (this.erpDetailMovId === movId) {
      this.erpDetailMovId = null;
      this.erpDetailPos   = null;
    } else {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.erpDetailPos   = { top: rect.bottom + 4, left: rect.left };
      this.erpDetailMovId = movId;
    }
  }

  toggleHistorial(movId: string, event: Event): void {
    event.stopPropagation();
    if (this.historialPopoverId === movId) {
      this.historialPopoverId = null;
      this.historialPos       = null;
    } else {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.historialPos       = { bottom: window.innerHeight - rect.top + 6, right: window.innerWidth - rect.right };
      this.historialPopoverId = movId;
    }
  }

  historialEntries(mov: BankMovement): { erpId: string; nombre: string; fecha: string }[] {
    const entries: { erpId: string; nombre: string; fecha: string }[] = [];
    if (mov.ficha) {
      entries.push({
        erpId:  `Ficha: ${mov.ficha}`,
        nombre: mov.fichaNombre || '—',
        fecha:  mov.fichaAt
          ? new Date(mov.fichaAt).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '—',
      });
    }
    for (const e of (mov.identificadoPor ?? [])) {
      entries.push({
        erpId:  e.erpId  || '—',
        nombre: e.nombre || e.userId || '?',
        fecha:  e.fechaId
          ? new Date(e.fechaId).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '—',
      });
    }
    return entries;
  }

  identificadoPorLabel(mov: BankMovement): string {
    const nombres: string[] = [];
    if (mov.fichaNombre) nombres.push(mov.fichaNombre);
    for (const e of (mov.identificadoPor ?? [])) {
      const n = e.nombre || (e.userId?.includes('|') ? e.userId.split('|')[1] : e.userId) || '?';
      if (!nombres.includes(n)) nombres.push(n);
    }
    return nombres.length ? nombres.join(', ') : '—';
  }

  statusLabel(s: BankStatus | string): string {
    const m: Record<string, string> = {
      no_identificado: 'No identificado',
      identificado:    'Identificado',
      otros:           'Otros',
      reclasificado:   'Por conciliar',
    };
    return m[s] ?? 'No identificado';
  }

  statusClass(s: BankStatus | string): string {
    const m: Record<string, string> = {
      no_identificado: 'st-pending',
      identificado:    'st-done',
      otros:           'st-other',
      reclasificado:   'st-reclasify',
    };
    return m[s] ?? 'st-pending';
  }

  catColor(cat: string | null): { bg: string; color: string } {
    if (!cat) return { bg: '#f1f5f9', color: '#94a3b8' };
    return this.categoriaColors[cat] ?? { bg: '#f1f5f9', color: '#475569' };
  }

  /** Categorías de la tarjeta a considerar para la fila — si hay un filtro de categoría
   *  activo, solo la que coincide (el resto ya no aporta nada útil a la vista filtrada
   *  y antes podía sacarla del recorte top-N, dejándola invisible del todo). */
  private categoriasParaFila(card: BankCard): { categoria: string; count: number; monto: number }[] {
    return this.filterCategoria
      ? card.porCategoria.filter(pc => pc.categoria === this.filterCategoria)
      : card.porCategoria;
  }

  /** Categorías a mostrar en la fila (top N) — nunca hace saltar de línea la franja de chips. */
  categoriasVisibles(card: BankCard): { categoria: string; count: number; monto: number }[] {
    return this.categoriasParaFila(card).slice(0, this.CATEGORIAS_VISIBLES);
  }

  /** Cuántas categorías quedan ocultas detrás del botón "+N más" (0 si no aplica). */
  categoriasOcultas(card: BankCard): number {
    return Math.max(0, this.categoriasParaFila(card).length - this.CATEGORIAS_VISIBLES);
  }

  /** Abre/cierra el popover con todas las categorías de un banco — mismo patrón que `toggleHistorial`. */
  toggleCategoriasPopover(banco: string, event: Event): void {
    event.stopPropagation();
    if (this.categoriasPopoverBanco === banco) {
      this.categoriasPopoverBanco = null;
      this.categoriasPopoverPos   = null;
    } else {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.categoriasPopoverPos   = { bottom: window.innerHeight - rect.top + 6, right: window.innerWidth - rect.right };
      this.categoriasPopoverBanco = banco;
    }
  }

  // ── Paginación ──────────────────────────────────────────────────────────────

  changePage(page: number): void { this.loadMovements(page); }

  pageNumbers(): number[] {
    const total = this.pagination.pages;
    const cur   = this.pagination.page;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set([1, total]);
    for (let i = Math.max(2, cur - 2); i <= Math.min(total - 1, cur + 2); i++) pages.add(i);
    const sorted = [...pages].sort((a, b) => a - b);
    const result: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push(-1);
      result.push(sorted[i]);
    }
    return result;
  }

  min(a: number, b: number): number { return Math.min(a, b); }
  abs(n: number): number { return Math.abs(n); }

  // ── Panel de reglas de categorización ───────────────────────────────────────

  openRulesPanel(): void { this.showRulesPanel = true; }
  closeRulesPanel(): void { this.showRulesPanel = false; }

  onRulesApplied(): void {
    this.availableCategorias = [];
    this.selectedCategorias  = [];
    this.loadMovements(1);
    this.loadAvailableCategorias(); // no-op si no hay activeBanco
    // Categorías nuevas/renombradas también deben reflejarse en las tarjetas del
    // dashboard (pills de categoría, filtro de categoría) — no solo en la tabla.
    this.loadCards();
  }

  // ── Modal Duplicados potenciales ─────────────────────────────────────────────
  showDuplicatesModal = false;

  openDuplicatesModal(): void  { this.showDuplicatesModal = true; }

  onAdminRefreshMovements(): void {
    if (this.view === 'detail') this.loadMovements(this.pagination.page);
  }
  closeDuplicatesModal(): void { this.showDuplicatesModal = false; }

  onDuplicateNavigate(e: { banco: string; movIds: string }): void {
    this.showDuplicatesModal = false;
    this.openBank(e.banco, e.movIds);
  }


  // ── Cobro ─────────────────────────────────────────────────────────────────

  openCobroLogin(): void {
    this.cobroPanelRef?.openCobroLogin();
  }


}
