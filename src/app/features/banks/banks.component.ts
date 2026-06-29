import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef } from '@angular/core';
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

@Component({
  standalone: false,
  selector: 'app-banks',
  templateUrl: './banks.component.html',
  styleUrls: ['./banks.component.css'],
})
export class BanksComponent implements OnInit, OnDestroy {

  readonly Math = Math;

  // ── Vista ───────────────────────────────────────────────────────────────────
  view: ViewMode = 'cards';
  activeBanco: string | null = null;
  // ── Tarjetas ────────────────────────────────────────────────────────────────
  bankCards:    BankCard[] = [];
  cardsLoading  = false;

  // ── Dashboard de estados (filtro por fecha) ──────────────────────────────────
  dashboardStats: Omit<BankStatusStats, 'years'> | null = null;
  dashboardStatsLoading  = false;
  dashboardYear:  number | null = null;
  dashboardMonth: number | null = null;
  availableYears: number[]      = [];

  readonly MESES = [
    { value: 1,  label: 'Enero' },   { value: 2,  label: 'Febrero' },
    { value: 3,  label: 'Marzo' },   { value: 4,  label: 'Abril' },
    { value: 5,  label: 'Mayo' },    { value: 6,  label: 'Junio' },
    { value: 7,  label: 'Julio' },   { value: 8,  label: 'Agosto' },
    { value: 9,  label: 'Septiembre' }, { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' },
  ];

  get dashboardTotals(): Omit<BankStatusStats, 'years'> {
    if (this.dashboardStats) return this.dashboardStats;
    const t = {
      no_identificado: 0, identificado: 0, otros: 0, reclasificado: 0,
      dep_no_identificado: 0, dep_identificado: 0, dep_otros: 0, dep_reclasificado: 0,
    };
    for (const c of this.bankCards) {
      t.no_identificado     += c.porStatus.no_identificado ?? 0;
      t.identificado        += c.porStatus.identificado    ?? 0;
      t.otros               += c.porStatus.otros           ?? 0;
      t.reclasificado       += c.porStatus.reclasificado   ?? 0;
      t.dep_no_identificado += c.saldoPendiente    ?? 0;
      t.dep_identificado    += c.saldoIdentificado ?? 0;
      t.dep_otros           += c.saldoOtros        ?? 0;
    }
    return t;
  }

  loadDashboardStats(): void {
    this.dashboardStatsLoading = true;
    this.bankService.statusStats(this.dashboardYear, this.dashboardMonth)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dashboardStats        = res;
          this.availableYears        = res.years;
          this.dashboardStatsLoading = false;
        },
        error: () => { this.dashboardStatsLoading = false; },
      });
  }

  onDashboardYearChange(): void {
    if (!this.dashboardYear) this.dashboardMonth = null;
    this.loadDashboardStats();
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
  colsCompacto         = true;  // por defecto oculta Categoría y Saldo
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
  reclasifying          = false;
  reclasifyError: string | null = null;

  inlineReclasifyId:     string | null                        = null;
  inlineCatPos:          { top: number; left: number } | null = null;
  inlineReclasifySaving: boolean                              = false;
  inlineReclasifyError:  string | null                        = null;

  toggleReclasifyMode(): void {
    this.reclasifyMode = !this.reclasifyMode;
    this.selectedForReclasify.clear();
    this.showReclasifyConfirm = false;
    this.reclasifyError       = null;
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

  confirmReclasifyMovements(): void {
    const ids = [...this.selectedForReclasify];
    if (ids.length === 0) return;
    this.reclasifying    = true;
    this.reclasifyError  = null;
    this.bankService.reclasifyMovements(ids)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.reclasifying          = false;
          this.showReclasifyConfirm  = false;
          this.reclasifyMode         = false;
          this.selectedForReclasify.clear();
          this.loadMovements(1);
        },
        error: () => {
          this.reclasifying   = false;
          this.reclasifyError = 'Error al reclasificar. Intenta de nuevo.';
        },
      });
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

  constructor(
    private bankService:   BankService,
    private fb:            FormBuilder,
    public  auth:          AuthService,
    private socketService: SocketService,
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

  get totalSaldoPendiente(): number {
    return this.bankCards.reduce((sum, c) => sum + (c.saldoPendiente ?? 0), 0);
  }

  // ── Visibilidad de columnas (se ocultan cuando el filtro las hace redundantes) ─
  get showDepositoCol(): boolean { return this.filterForm.get('tipo')!.value !== 'retiro'; }
  get showRetiroCol():   boolean {
    return this.filterForm.get('tipo')!.value !== 'deposito' && !this.auth.hasRole('cobranza');
  }
  get showSaldoActualizadoCol(): boolean {
    return !this.auth.hasRole('cobranza') && !this.colsCompacto;
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

    this.loadCards();
    this.loadDashboardStats();

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
    this.bankService.cards().pipe(takeUntil(this.destroy$)).subscribe({
      next: (cards) => { this.bankCards = cards; this.cardsLoading = false; },
      error: ()      => { this.cardsLoading = false; },
    });
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

  // ── Status inline ───────────────────────────────────────────────────────────

  isLockedByOther(mov: BankMovement): boolean {
    if (this.auth.hasRole('admin')) return false;
    const entries = mov.identificadoPor ?? [];
    return (
      mov.status === 'identificado' &&
      entries.length > 0 &&
      !entries.some(e => e.userId === this.auth.currentUser.id)
    );
  }

  cycleStatus(mov: BankMovement): void {
    if (!this.auth.hasRole('admin')) return;

    const bankAmount  = Math.abs(mov.deposito ?? mov.retiro ?? 0);
    const erpCuadra   = mov.saldoErp != null && mov.saldoErp >= bankAmount - 1.0;
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
    this.historialPopoverId = null;
    this.historialPos       = null;
    this.erpDetailMovId     = null;
    this.erpDetailPos       = null;
    this.showDatePicker     = false;
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
