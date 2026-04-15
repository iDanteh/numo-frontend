import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { merge, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, takeUntil } from 'rxjs/operators';
import {
  BankService, BankMovement, BankCard, BankFilter, BankStatus, ErpCxC, ErpLink,
  BankRule, BankRuleCondicion, RuleCampo, RuleOperador,
} from '../../core/services/bank.service';
import { AuthService } from '../../core/services/auth.service';
import { SocketService, BankImportProgressEvent } from '../../core/services/socket.service';

type ViewMode  = 'cards' | 'detail';
type SortDir   = 'asc' | 'desc';
type SortField = 'fecha' | 'banco' | 'deposito' | 'retiro';

@Component({
  standalone: false,
  selector: 'app-banks',
  templateUrl: './banks.component.html',
})
export class BanksComponent implements OnInit, OnDestroy {

  readonly Math = Math;

  // ── Vista ───────────────────────────────────────────────────────────────────
  view: ViewMode = 'cards';
  activeBanco: string | null = null;

  // ── Tarjetas ────────────────────────────────────────────────────────────────
  bankCards:    BankCard[] = [];
  cardsLoading  = false;

  // ── Movimientos (vista detalle) ─────────────────────────────────────────────
  movements: BankMovement[] = [];
  pagination = { total: 0, page: 1, limit: 50, pages: 0 };
  loading    = false;

  // ── Filtros activos (detalle) ───────────────────────────────────────────────
  activeStatus:       string = '';
  conceptoFilter:         string = '';
  showConceptoFilter      = false;
  identificadoPorFilter:  string = '';
  showIdentificadoPorFilter = false;
  showCategoriaFilter  = false;
  availableCategorias: (string | null)[] = [];
  selectedCategorias:  string[] = [];   // '__null__' represents null/sin categoría
  categoriasLoading    = false;
  filterForm: FormGroup;
  sortField: SortField = 'fecha';
  sortDir:   SortDir   = 'desc';

  auxError: string | null = null;

  // ── Modal de importación ────────────────────────────────────────────────────
  showImportModal  = false;
  importBanco      = '';
  selectedFile: File | null = null;
  uploading        = false;
  isDragging       = false;
  uploadResult:    { importados: number; duplicados: number; categorizados?: number; sinReglas?: boolean; resumen: Record<string, number> } | null = null;
  uploadError:     string | null = null;
  importProgress:  BankImportProgressEvent | null = null;

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

  // ── Match ERP ───────────────────────────────────────────────────────────────
  matchingErp        = false;
  revertingErp       = false;
  matchErpResult:    { matched: number; message: string } | null = null;
  revertErpResult:   { reverted: number; message: string } | null = null;
  matchErpError:     string | null = null;

  runMatchErp(): void {
    this.matchingErp    = true;
    this.matchErpResult = null;
    this.revertErpResult = null;
    this.matchErpError  = null;
    this.bankService.matchErp().subscribe({
      next: (res) => {
        this.matchErpResult = res;
        this.matchingErp    = false;
        if (res.matched > 0) this.loadCards();
      },
      error: (err) => {
        this.matchErpError = err?.error?.error || 'Error al ejecutar el motor ERP';
        this.matchingErp   = false;
      },
    });
  }

  runRevertMatchErp(): void {
    this.revertingErp    = true;
    this.matchErpResult  = null;
    this.revertErpResult = null;
    this.matchErpError   = null;
    this.bankService.revertMatchErp().subscribe({
      next: (res) => {
        this.revertErpResult = res;
        this.revertingErp    = false;
        if (res.reverted > 0) this.loadCards();
      },
      error: (err) => {
        this.matchErpError = err?.error?.error || 'Error al revertir asociaciones ERP';
        this.revertingErp  = false;
      },
    });
  }

  // ── Match de autorizaciones ─────────────────────────────────────────────────
  matchingAuts       = false;
  matchAutsResult: {
    total: number; matcheados: number; identificados: number; sinMatch: number;
    noMatcheados: { autorizacion: string; importe: number; banco: string | null }[];
  } | null = null;
  showNoMatcheados = false;
  matchAutsError:  string | null = null;

  // ── Match de autorizaciones ─────────────────────────────────────────────────

  onAutsFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    input.value = '';
    this.runMatchAutorizaciones(file);
  }

  private runMatchAutorizaciones(file: File): void {
    this.matchingAuts    = true;
    this.matchAutsResult = null;
    this.matchAutsError  = null;
    this.showNoMatcheados = false;

    this.bankService.matchAutorizaciones(file).subscribe({
      next: (res) => {
        this.matchAutsResult = res;
        this.matchingAuts    = false;
        this.loadCards();
      },
      error: (err) => {
        this.matchAutsError = err?.error?.error || 'Error al procesar el archivo';
        this.matchingAuts   = false;
      },
    });
  }

  // ── Modal de cuenta contable ────────────────────────────────────────────────
  showCuentaModal  = false;
  cuentaModalCard: BankCard | null = null;
  cuentaInput      = '';
  numeroCuentaInput = '';
  savingCuenta     = false;

  // ── Modal IDs ERP ────────────────────────────────────────────────────────────
  showErpModal      = false;
  erpModalMovement: BankMovement | null = null;
  erpSearch         = '';
  erpCxcList:  ErpCxC[] = [];
  erpLoading        = false;
  erpError: string | null = null;
  erpSaving         = false;
  erpSoloPendientes = true;
  private erpIdsOriginal: string[] = [];

  // ── Panel de reglas de categorización ────────────────────────────────────────
  showRulesPanel    = false;
  rules:            BankRule[] = [];
  rulesLoading      = false;
  applyingRules     = false;
  applyRulesResult: { actualizados: number; sinCambio: number } | null = null;
  applyRulesError:  string | null = null;

  // ── Confirmación eliminar regla ───────────────────────────────────────────
  showDeleteRuleModal = false;
  ruleToDelete: BankRule | null = null;

  // Formulario de regla (crear / editar)
  showRuleForm   = false;
  editingRuleId: string | null = null;
  ruleNombre     = '';
  ruleLogica:    'Y' | 'O' = 'Y';
  ruleCondiciones: { campo: RuleCampo; operador: RuleOperador; valor: string }[] = [];
  savingRule     = false;
  ruleError:     string | null = null;

  readonly CAMPOS_REGLA: { value: RuleCampo; label: string }[] = [
    { value: 'concepto',           label: 'Concepto' },
    { value: 'deposito',           label: 'Depósito' },
    { value: 'retiro',             label: 'Retiro' },
    { value: 'referenciaNumerica', label: 'Referencia' },
    { value: 'numeroAutorizacion', label: 'Autorización' },
  ];

  readonly OPERADORES_REGLA: { value: RuleOperador; label: string; numerico?: boolean }[] = [
    { value: 'contiene',    label: 'contiene' },
    { value: 'no_contiene', label: 'no contiene' },
    { value: 'igual',       label: 'igual a' },
    { value: 'empieza_con', label: 'empieza con' },
    { value: 'termina_con', label: 'termina con' },
    { value: 'mayor_que',   label: 'mayor que',   numerico: true },
    { value: 'menor_que',   label: 'menor que',   numerico: true },
    { value: 'mayor_igual', label: 'mayor o igual', numerico: true },
    { value: 'menor_igual', label: 'menor o igual', numerico: true },
  ];

  // Rango de fechas para consultar el ERP (por defecto: mes actual)
  erpFechaDesde = this.defaultFechaDesde();
  erpFechaHasta = this.defaultFechaHasta();

  private defaultFechaDesde(): string {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10) + 'T00:00:00Z';
  }

  private defaultFechaHasta(): string {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString().slice(0, 10) + 'T23:59:59Z';
  }

  get filteredCxC(): ErpCxC[] {
    const q = this.erpSearch.toLowerCase().trim();
    if (!q) return this.erpCxcList;
    return this.erpCxcList.filter(c =>
      c.id.toLowerCase().includes(q) ||
      c.folio.toLowerCase().includes(q) ||
      c.serie.toLowerCase().includes(q) ||
      String(c.total).includes(q) ||
      String(c.saldoActual).includes(q)
    );
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

  private destroy$       = new Subject<void>();
  private loadTrigger$   = new Subject<BankFilter>();
  private conceptoFilter$         = new Subject<string>();
  private identificadoPorFilter$  = new Subject<string>();

  constructor(private bankService: BankService, private fb: FormBuilder, public auth: AuthService, private socketService: SocketService) {
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

    this.identificadoPorFilter$.pipe(
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
        this.movements[idx] = { ...prev, ...updated } as BankMovement;
        this.movements = [...this.movements];
        if (updated.status === 'identificado' && prev.status !== 'identificado') {
          this.showAuthToast(this.movements[idx].folio);
        }
      }
    });

    this.socketService.erpMatchDone$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.loadCards();
      if (this.view === 'detail') this.loadMovements(this.pagination.page);
    });

    this.socketService.importProgress$.pipe(takeUntil(this.destroy$)).subscribe(progress => {
      this.importProgress = progress;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this._authToastTimer) clearTimeout(this._authToastTimer);
  }

  // ── Navegación ──────────────────────────────────────────────────────────────

  openBank(banco: string): void {
    if (this.activeBanco && this.activeBanco !== banco) {
      this.socketService.leaveBanco(this.activeBanco);
    }
    this.activeBanco        = banco;
    this.view               = 'detail';
    this.activeStatus       = '';
    this.conceptoFilter           = '';
    this.identificadoPorFilter    = '';
    this.selectedCategorias       = [];
    this.availableCategorias      = [];
    this.showConceptoFilter       = false;
    this.showIdentificadoPorFilter = false;
    this.showCategoriaFilter      = false;
    this.showRulesPanel      = false;
    this.filterForm.reset({ search: '', tipo: '', fechaInicio: '', fechaFin: '' });
    this.socketService.joinBanco(banco);
    this.loadMovements(1);
  }

  goBack(): void {
    if (this.activeBanco) this.socketService.leaveBanco(this.activeBanco);
    this.view        = 'cards';
    this.activeBanco = null;
    this.movements   = [];
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
      limit:       this.pagination.limit,
      banco:       this.activeBanco     || undefined,
      search:      search               || undefined,
      tipo:        tipo                 || undefined,
      fechaInicio: fechaInicio          || undefined,
      fechaFin:    fechaFin             || undefined,
      status:      this.activeStatus    || undefined,
      concepto:         this.conceptoFilter        || undefined,
      identificadoPor:  this.identificadoPorFilter  || undefined,
      categorias:       this.selectedCategorias.length ? this.selectedCategorias.join(',') : undefined,
      sortBy:      this.sortField,
      sortDir:     this.sortDir,
    };

    this.loadTrigger$.next(filters);
  }

  // ── Filtros ─────────────────────────────────────────────────────────────────

  hasActiveFilters(): boolean {
    const v = this.filterForm.value;
    return !!(v.search || v.tipo || v.fechaInicio || v.fechaFin
              || this.activeStatus || this.conceptoFilter || this.identificadoPorFilter || this.selectedCategorias.length);
  }

  clearFilters(): void {
    this.activeStatus            = '';
    this.conceptoFilter          = '';
    this.identificadoPorFilter   = '';
    this.selectedCategorias      = [];
    this.filterForm.reset({ search: '', tipo: '', fechaInicio: '', fechaFin: '' });
    this.conceptoFilter$.next('');
    this.identificadoPorFilter$.next('');
  }

  onConceptoFilterChange(): void {
    this.conceptoFilter$.next(this.conceptoFilter);
  }

  onIdentificadoPorFilterChange(): void {
    this.identificadoPorFilter$.next(this.identificadoPorFilter);
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

  openImportModal(): void {
    this.importBanco  = this.activeBanco || '';
    this.selectedFile = null;
    this.uploadResult = null;
    this.uploadError  = null;
    this.showImportModal = true;
  }

  closeImportModal(): void {
    this.showImportModal = false;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setFile(input.files?.[0] ?? null);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
    const file = event.dataTransfer?.files[0];
    if (file && /\.(xlsx|xls)$/i.test(file.name)) this.setFile(file);
  }

  onDragOver(event: DragEvent): void { event.preventDefault(); this.isDragging = true; }
  onDragLeave(): void { this.isDragging = false; }

  private setFile(file: File | null): void {
    this.selectedFile = file;
    this.uploadResult = null;
    this.uploadError  = null;
  }

  uploadExcel(): void {
    if (!this.selectedFile || this.uploading) return;
    this.uploading      = true;
    this.uploadError    = null;
    this.importProgress = null;

    this.bankService.upload(this.selectedFile, this.importBanco || undefined).subscribe({
      next: (res) => {
        this.uploadResult   = res as any;
        this.uploading      = false;
        this.importProgress = null;
        this.selectedFile   = null;
        this.loadCards();
        if (this.view === 'detail') this.loadMovements(1);
      },
      error: (err) => {
        this.uploadError    = err?.error?.error || 'Error al procesar el archivo';
        this.uploading      = false;
        this.importProgress = null;
      },
    });
  }

  // ── Modal de cuenta contable ────────────────────────────────────────────────

  openCuentaModal(card: BankCard, event: Event): void {
    event.stopPropagation();
    this.cuentaModalCard    = card;
    this.cuentaInput        = card.cuentaContable || '';
    this.numeroCuentaInput  = card.numeroCuenta   || '';
    this.savingCuenta       = false;
    this.showCuentaModal    = true;
  }

  closeCuentaModal(): void {
    this.showCuentaModal = false;
    this.cuentaModalCard = null;
  }

  saveCuenta(): void {
    if (!this.cuentaModalCard || this.savingCuenta) return;
    this.savingCuenta = true;
    this.bankService.saveBankConfig(this.cuentaModalCard.banco, {
      cuentaContable: this.cuentaInput        || null as any,
      numeroCuenta:   this.numeroCuentaInput  || null as any,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (cfg) => {
        const card = this.bankCards.find(c => c.banco === this.cuentaModalCard!.banco);
        if (card) {
          card.cuentaContable = cfg.cuentaContable;
          card.numeroCuenta   = cfg.numeroCuenta;
        }
        this.savingCuenta = false;
        this.closeCuentaModal();
      },
      error: () => { this.savingCuenta = false; },
    });
  }

  // ── Modal UUID CFDI ─────────────────────────────────────────────────────────

  // ── IDs ERP ─────────────────────────────────────────────────────────────────

  openErpModal(mov: BankMovement, event: Event): void {
    event.stopPropagation();
    if (this.isLockedByOther(mov)) return;
    this.erpModalMovement  = mov;
    this.erpIdsOriginal    = [...(mov.erpIds ?? [])];
    this.erpSearch         = '';
    this.erpSaving         = false;
    this.showErpModal      = true;
    this.loadErpCuentas();
  }

  closeErpModal(): void {
    // Revert local changes if not confirmed
    if (this.erpModalMovement) {
      this.erpModalMovement.erpIds = [...this.erpIdsOriginal];
    }
    this.showErpModal     = false;
    this.erpModalMovement = null;
    this.erpCxcList       = [];
    this.erpError         = null;
    this.erpSaving        = false;
  }

  confirmErp(): void {
    if (!this.erpModalMovement || this.erpSaving) return;
    this.erpSaving = true;
    const mov = this.erpModalMovement;
    const ids  = [...(mov.erpIds ?? [])];

    // Construir erpLinks con snapshot de saldoActual y folioFiscal por cada ID seleccionado
    const erpLinks: ErpLink[] = ids.map(erpId => {
      const cxc = this.erpCxcList.find(c => c.id === erpId);
      if (cxc) {
        return {
          erpId,
          saldoActual: cxc.saldoActual,
          folioFiscal: cxc.folioFiscal ?? null,
          total: cxc.total,           // ← siempre el total del ERP
        };
      }
      const prev = (mov.erpLinks ?? []).find((l: ErpLink) => l.erpId === erpId);
      if (prev) return prev;

    // Si no hay ninguna referencia, loguear el caso — no debería ocurrir
      console.warn(`[confirmErp] erpId ${erpId} no encontrado en lista ni en links previos`);
      return { erpId, saldoActual: 0, folioFiscal: null, total: 0 };
    });

    this.bankService.setErpIds(mov._id, erpLinks)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          mov.erpIds          = res.erpIds;
          mov.erpLinks        = res.erpLinks;
          mov.saldoErp        = res.saldoErp;
          mov.uuidXML         = res.uuidXML;
          mov.status          = res.status;
          mov.identificadoPor = res.identificadoPor ?? null;
          this.erpIdsOriginal   = [...res.erpIds];
          this.erpSaving        = false;
          this.showErpModal     = false;
          this.erpModalMovement = null;
          this.erpCxcList       = [];
          this.loadCards();
          if (res.status === 'identificado') this.showAuthToast(mov.folio);
        },
        error: () => { this.erpSaving = false; },
      });
  }

  loadErpCuentas(): void {
    this.erpLoading = true;
    this.erpError   = null;
    this.bankService.listErpCuentas(this.erpFechaDesde, this.erpFechaHasta, this.erpSoloPendientes)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (list) => { this.erpCxcList = list; this.erpLoading = false; },
        error: (err) => {
          this.erpError   = err?.error?.error || 'Error al consultar el ERP';
          this.erpLoading = false;
        },
      });
  }

  isCxCLinked(id: string): boolean {
    return (this.erpModalMovement?.erpIds ?? []).includes(id);
  }

  toggleCxC(id: string): void {
    if (!this.erpModalMovement) return;
    const ids = this.erpModalMovement.erpIds ?? [];
    if (ids.includes(id)) {
      this.erpModalMovement.erpIds = ids.filter(x => x !== id);
    } else {
      this.erpModalMovement.erpIds = [...ids, id];
    }
  }

  unlinkCxC(id: string, event: Event): void {
    event.stopPropagation();
    if (!this.erpModalMovement) return;
    this.erpModalMovement.erpIds = (this.erpModalMovement.erpIds ?? []).filter(x => x !== id);
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
        mov.identificadoPor = res.identificadoPor ?? null;
        this.loadCards();
      },
    });
  }

  erpDiferencia(m: BankMovement): number | null {
    if (!m.erpLinks?.length) return null;
    console.log('erpLinks:', JSON.stringify(m.erpLinks));
    const totalErp = m.erpLinks.reduce((sum, l) => sum + (l.total ?? 0), 0);
    return (m.deposito ?? m.retiro ?? 0) - totalErp;
  }

  // ── Status inline ───────────────────────────────────────────────────────────

  isLockedByOther(mov: BankMovement): boolean {
    if (this.auth.hasRole('admin')) return false;
    return (
      mov.status === 'identificado' &&
      !!mov.identificadoPor?.userId &&
      mov.identificadoPor.userId !== this.auth.currentUser.id
    );
  }

  cycleStatus(mov: BankMovement): void {
    if (!this.auth.hasRole('admin')) return;
    const bankAmount = mov.deposito ?? mov.retiro ?? 0;
    if (mov.saldoErp !== null && mov.saldoErp !== undefined && Math.abs(bankAmount - mov.saldoErp) <= 1.0) return;
    if (this.isLockedByOther(mov)) return;
    const order: BankStatus[] = ['no_identificado', 'identificado', 'otros'];
    let next = order[(order.indexOf(mov.status) + 1) % order.length];
    // Si el siguiente estado es 'identificado' pero no tiene ERP asociado, saltar al siguiente
    if (next === 'identificado' && (!mov.erpIds || mov.erpIds.length === 0)) {
      next = order[(order.indexOf(next) + 1) % order.length];
    }
    this.bankService.updateStatus(mov._id, next).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        mov.status          = res.status;
        mov.identificadoPor = res.identificadoPor ?? null;
        this.loadCards();
        if (res.status === 'identificado') this.showAuthToast(mov.folio);
      },
    });
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
      concepto:        this.conceptoFilter          || undefined,
      identificadoPor: this.identificadoPorFilter   || undefined,
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

  identificadoPorLabel(mov: BankMovement): string {
    const ip = mov.identificadoPor;
    if (!ip?.userId) return '—';
    if (ip.nombre)   return ip.nombre;
    // Fallback: usa la parte del sub después de '|' (ej: auth0|abc123 → abc123)
    return ip.userId.includes('|') ? ip.userId.split('|')[1] : ip.userId;
  }

  statusLabel(s: BankStatus | string): string {
    const m: Record<string, string> = {
      no_identificado: 'No identificado',
      identificado:    'Identificado',
      otros:           'Otros',
    };
    return m[s] ?? 'No identificado';
  }

  statusClass(s: BankStatus | string): string {
    const m: Record<string, string> = {
      no_identificado: 'st-pending',
      identificado:    'st-done',
      otros:           'st-other',
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

  // ── Panel de reglas de categorización ───────────────────────────────────────

  openRulesPanel(): void {
    this.showRulesPanel   = true;
    this.showRuleForm     = false;
    this.applyRulesResult = null;
    this.applyRulesError  = null;
    this.loadRules();
  }

  closeRulesPanel(): void {
    this.showRulesPanel = false;
    this.showRuleForm   = false;
  }

  loadRules(): void {
    if (!this.activeBanco) return;
    this.rulesLoading = true;
    this.bankService.listRules(this.activeBanco).pipe(takeUntil(this.destroy$)).subscribe({
      next: (rules) => { this.rules = rules; this.rulesLoading = false; },
      error: ()     => { this.rulesLoading = false; },
    });
  }

  openNewRule(): void {
    this.editingRuleId  = null;
    this.ruleNombre     = '';
    this.ruleLogica     = 'Y';
    this.ruleCondiciones = [{ campo: 'concepto', operador: 'contiene', valor: '' }];
    this.ruleError      = null;
    this.showRuleForm   = true;
  }

  openEditRule(rule: BankRule): void {
    this.editingRuleId   = rule._id;
    this.ruleNombre      = rule.nombre;
    this.ruleLogica      = rule.logica;
    this.ruleCondiciones = rule.condiciones.map(c => ({ ...c }));
    this.ruleError       = null;
    this.showRuleForm    = true;
  }

  cancelRuleForm(): void {
    this.showRuleForm  = false;
    this.editingRuleId = null;
    this.ruleError     = null;
  }

  addCondicion(): void {
    this.ruleCondiciones.push({ campo: 'concepto', operador: 'contiene', valor: '' });
  }

  removeCondicion(i: number): void {
    this.ruleCondiciones.splice(i, 1);
  }

  saveRule(): void {
    if (!this.activeBanco || this.savingRule) return;
    if (!this.ruleNombre.trim()) { this.ruleError = 'El nombre es requerido'; return; }
    if (this.ruleCondiciones.length === 0) { this.ruleError = 'Añade al menos una condición'; return; }
    if (this.ruleCondiciones.some(c => !c.valor.trim())) { this.ruleError = 'Todos los valores son requeridos'; return; }

    this.savingRule = true;
    this.ruleError  = null;

    const data = {
      nombre:      this.ruleNombre.trim(),
      logica:      this.ruleLogica,
      condiciones: this.ruleCondiciones,
      orden:       this.editingRuleId ? (this.rules.find(r => r._id === this.editingRuleId)?.orden ?? 0) : this.rules.length,
    };

    const req$ = this.editingRuleId
      ? this.bankService.updateRule(this.editingRuleId, data)
      : this.bankService.createRule(this.activeBanco, data);

    req$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.savingRule    = false;
        this.showRuleForm  = false;
        this.editingRuleId = null;
        this.loadRules();
      },
      error: (err) => {
        this.ruleError  = err?.error?.error || 'Error al guardar la regla';
        this.savingRule = false;
      },
    });
  }

  openDeleteRuleModal(rule: BankRule): void {
    this.ruleToDelete       = rule;
    this.showDeleteRuleModal = true;
  }

  closeDeleteRuleModal(): void {
    this.showDeleteRuleModal = false;
    this.ruleToDelete       = null;
  }

  confirmDeleteRule(): void {
    if (!this.ruleToDelete) return;
    const id = this.ruleToDelete._id;
    this.closeDeleteRuleModal();
    this.bankService.deleteRule(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => this.loadRules(),
    });
  }

  applyRules(soloSinCategoria = false): void {
    if (!this.activeBanco || this.applyingRules) return;
    this.applyingRules   = true;
    this.applyRulesResult = null;
    this.applyRulesError  = null;
    this.bankService.applyRules(this.activeBanco, soloSinCategoria)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.applyRulesResult    = res;
          this.applyingRules       = false;
          this.availableCategorias = [];   // force reload on next filter open
          this.loadMovements(1);
        },
        error: (err) => {
          this.applyRulesError = err?.error?.error || 'Error al aplicar reglas';
          this.applyingRules   = false;
        },
      });
  }
}
