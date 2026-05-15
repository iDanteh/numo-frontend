import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  PolizaService, Poliza, PolizaFilter, PolizaTipo, PolizaEstado, PolizaMovimiento,
} from '../../core/services/poliza.service';
import {
  CfdiMappingService, CfdiMappingRule, BalanzaPreliminar, BalanceGeneral,
} from '../../core/services/cfdi-mapping.service';
import { AccountPlanService, AccountPlan } from '../../core/services/account-plan.service';
import { EntidadActivaService } from '../../core/services/entidad-activa.service';
import { PeriodoActivoService } from '../../core/services/periodo-activo.service';
import { AuthService } from '../../core/services/auth.service';

export type ActiveTab = 'polizas' | 'reglas' | 'balanza' | 'balance';
type ConfirmAction = 'contabilizar' | 'cancelar' | 'revertir';

interface MovimientoRow {
  cuentaId: number | null;
  cuentaBusqueda: string;
  cuentaSugerencias: AccountPlan[];
  concepto: string;
  debe: number | string;
  haber: number | string;
  cfdiUuid: string;
  rfcTercero: string;
}

@Component({
  standalone: false,
  selector: 'app-poliza-list',
  templateUrl: './poliza-list.component.html',
})
export class PolizaListComponent implements OnInit, OnDestroy {

  // ── Tab activo ───────────────────────────────────────────────────────────────
  activeTab: ActiveTab = 'polizas';

  // ── Pólizas ──────────────────────────────────────────────────────────────────
  polizas:       Poliza[] = [];
  loading        = false;
  loadingNextPage = false;   // true sólo cuando ya hay datos y se cambia de página
  error:         string | null = null;
  pagination = { total: 0, page: 1, limit: 50, pages: 0 };
  filterTipo   = '';
  filterEstado = '';
  cachedPageNumbers: number[] = [];

  // Modal detalle póliza
  showDetailModal   = false;
  detailPoliza:     Poliza | null = null;
  detailTotalDebe   = 0;
  detailTotalHaber  = 0;
  detailBalanceado  = true;
  detailMovGroups:  number[] = [];
  movPage           = 1;
  readonly movPageSize = 15;

  get movimientosPaginated(): PolizaMovimiento[] {
    if (!this.detailPoliza?.movimientos) return [];
    const start = (this.movPage - 1) * this.movPageSize;
    return this.detailPoliza.movimientos.slice(start, start + this.movPageSize);
  }
  get movTotalPages(): number {
    return Math.ceil((this.detailPoliza?.movimientos?.length ?? 0) / this.movPageSize);
  }
  get movGroupsPaginated(): number[] {
    const start = (this.movPage - 1) * this.movPageSize;
    return this.detailMovGroups.slice(start, start + this.movPageSize);
  }
  get movPageNumbers(): number[] {
    const pages = this.movTotalPages;
    const page  = this.movPage;
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    const set = new Set([1, pages]);
    for (let i = Math.max(2, page - 2); i <= Math.min(pages - 1, page + 2); i++) set.add(i);
    const sorted = [...set].sort((a, b) => a - b);
    const res: number[] = [];
    sorted.forEach((v, i) => { if (i > 0 && v - sorted[i - 1] > 1) res.push(-1); res.push(v); });
    return res;
  }

  // Modal crear/editar póliza
  showModal   = false;
  editingId:  number | null = null;
  saving      = false;
  modalError: string | null = null;
  formTipo:      PolizaTipo = 'D';
  formFecha      = '';
  formConcepto   = '';
  formFolio      = '';
  formMovimientos: MovimientoRow[] = [];

  // Modal confirmar acción (contabilizar/cancelar/revertir)
  showConfirm    = false;
  confirmAction: ConfirmAction | null = null;
  confirmPoliza: Poliza | null = null;
  confirmMotivo  = '';
  confirmLoading = false;
  confirmError:  string | null = null;

  // Modal XML SAT
  showXmlModal     = false;
  xmlTipoSolicitud = 'AF';
  xmlNumOrden      = '';
  xmlNumTramite    = '';
  exportandoXml    = false;
  xmlError:        string | null = null;

  // Modal generar póliza desde CFDIs
  showGenerar    = false;
  generarTipo:   'I' | 'E' | 'P' = 'I';
  generarLoading = false;
  generarResult: { polizaId: number; totalCfdis: number; sinRegla: number; advertencias: string[] } | null = null;
  generarError:  string | null = null;

  readonly tiposPoliza: { value: PolizaTipo; label: string }[] = [
    { value: 'A', label: 'Apertura' },
    { value: 'I', label: 'Ingreso' },
    { value: 'E', label: 'Egreso' },
    { value: 'D', label: 'Diario' },
    { value: 'N', label: 'Nómina' },
    { value: 'C', label: 'Cheque' },
  ];

  readonly estadoColors: Record<PolizaEstado, string> = {
    borrador:      'badge-secondary',
    contabilizada: 'badge-success',
    cancelada:     'badge-danger',
  };

  readonly estadoLabels: Record<PolizaEstado, string> = {
    borrador:      'Borrador',
    contabilizada: 'Contabilizada',
    cancelada:     'Cancelada',
  };

  // ── Reglas contables ─────────────────────────────────────────────────────────
  rules: CfdiMappingRule[] = [];
  rulesLoading = false;
  rulesError:  string | null = null;

  showRuleModal  = false;
  editingRuleId: number | null = null;
  savingRule     = false;
  ruleError:     string | null = null;

  ruleNombre      = '';
  ruleTipo:       'I' | 'E' | 'P' | '' = '';
  ruleRfcEmisor   = '';
  ruleMetodoPago  = '';
  ruleFormaPago   = '';
  ruleCuentaCargo = '';
  ruleCuentaAbono = '';
  ruleCuentaIva   = '';
  ruleCuentaIvaPPD       = '';
  ruleCuentaIvaRetenido  = '';
  ruleCuentaIsrRetenido  = '';
  ruleCentroCosto = '';
  rulePrioridad   = 50;
  ruleIsActive    = true;

  showDeleteRule   = false;
  deletingRule: CfdiMappingRule | null = null;
  deletingRuleLoading = false;

  // ── Balanza de comprobación ───────────────────────────────────────────────────
  balanza: BalanzaPreliminar | null = null;
  balanzaLoading = false;
  balanzaError:  string | null = null;
  balanzaTipoCfdi = '';
  balanzaSearch   = '';

  get balanzaCuentasFiltradas() {
    if (!this.balanza) return [];
    const q = this.balanzaSearch.trim().toLowerCase();
    if (!q) return this.balanza.cuentas;
    return this.balanza.cuentas.filter(c =>
      c.codigo.toLowerCase().includes(q) || c.nombre.toLowerCase().includes(q)
    );
  }

  // ── Balance general ───────────────────────────────────────────────────────────
  balance: BalanceGeneral | null = null;
  balanceLoading = false;
  balanceError:  string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private svc:        PolizaService,
    private mappingSvc: CfdiMappingService,
    private accountSvc: AccountPlanService,
    private entidad:    EntidadActivaService,
    private periodo:    PeriodoActivoService,
    public  auth:       AuthService,
  ) {}

  get rfc(): string { return this.entidad.snapshot?.rfc ?? ''; }
  get ejercicio(): number | null { return this.periodo.snapshot.ejercicio; }
  get periodoActivo(): number | null { return this.periodo.snapshot.periodo; }
  get isAdmin(): boolean { return this.auth.hasRole('admin'); }
  get hasPeriodo(): boolean { return !!(this.rfc && this.ejercicio && this.periodoActivo); }

  get debeTotal(): number {
    return this.formMovimientos.reduce((s, m) => s + (Number(m.debe) || 0), 0);
  }
  get haberTotal(): number {
    return this.formMovimientos.reduce((s, m) => s + (Number(m.haber) || 0), 0);
  }
  get balanceado(): boolean {
    return Math.abs(this.debeTotal - this.haberTotal) <= 0.01 && this.debeTotal > 0;
  }

  ngOnInit(): void {
    this.loadPolizas();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────────

  setTab(tab: ActiveTab): void {
    this.activeTab = tab;
    if (tab === 'polizas' && this.polizas.length === 0) this.loadPolizas();
    if (tab === 'reglas'  && this.rules.length === 0)   this.loadRules();
    if (tab === 'balanza' && !this.balanza)              this.loadBalanza();
    if (tab === 'balance' && !this.balance)              this.loadBalance();
  }

  // ── Pólizas ──────────────────────────────────────────────────────────────────

  loadPolizas(page = 1): void {
    if (!this.hasPeriodo) return;
    // Si ya hay datos, usamos overlay suave en vez de borrar la tabla
    if (this.polizas.length > 0) {
      this.loadingNextPage = true;
    } else {
      this.loading = true;
    }
    this.error = null;
    const filters: PolizaFilter = {
      rfc: this.rfc, ejercicio: this.ejercicio!, periodo: this.periodoActivo!,
      page, limit: this.pagination.limit,
    };
    if (this.filterTipo)   filters.tipo   = this.filterTipo;
    if (this.filterEstado) filters.estado = this.filterEstado;

    this.svc.list(filters).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.polizas            = res.polizas;
        this.pagination         = { total: res.total, page: res.page, limit: res.limit, pages: res.pages };
        this.cachedPageNumbers  = this.pageNumbers();
        this.loading            = false;
        this.loadingNextPage    = false;
      },
      error: (err) => {
        this.error           = err?.error?.error || 'Error al cargar pólizas';
        this.loading         = false;
        this.loadingNextPage = false;
      },
    });
  }

  onFilterChange(): void { this.loadPolizas(1); }
  changePage(page: number): void { this.loadPolizas(page); }

  pageNumbers(): number[] {
    const { pages, page } = this.pagination;
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    const set = new Set([1, pages]);
    for (let i = Math.max(2, page - 2); i <= Math.min(pages - 1, page + 2); i++) set.add(i);
    const sorted = [...set].sort((a, b) => a - b);
    const res: number[] = [];
    sorted.forEach((v, i) => { if (i > 0 && v - sorted[i - 1] > 1) res.push(-1); res.push(v); });
    return res;
  }

  openDetail(p: Poliza): void {
    this.detailPoliza    = p;
    this.showDetailModal = true;
    this.movPage         = 1;
    this.computeDetailTotals(p.movimientos);
    if (!p.movimientos) {
      this.svc.getById(p.id).pipe(takeUntil(this.destroy$)).subscribe({
        next: (full) => {
          const idx = this.polizas.findIndex(x => x.id === full.id);
          if (idx >= 0) this.polizas[idx] = full;
          if (this.detailPoliza?.id === full.id) {
            this.detailPoliza = full;
            this.computeDetailTotals(full.movimientos);
          }
        },
      });
    }
  }

  private computeDetailTotals(movs: PolizaMovimiento[] | undefined): void {
    const list = movs ?? [];
    this.detailTotalDebe  = list.reduce((s, m) => s + (Number(m.debe)  || 0), 0);
    this.detailTotalHaber = list.reduce((s, m) => s + (Number(m.haber) || 0), 0);
    this.detailBalanceado = Math.abs(this.detailTotalDebe - this.detailTotalHaber) <= 0.01;

    // Grupo de color alternado por CFDI UUID (blanco / gris)
    this.detailMovGroups = [];
    let group = 0;
    let lastUuid: string | null = undefined as any;
    for (const m of list) {
      const uuid = m.cfdiUuid || null;
      if (lastUuid !== undefined && uuid !== lastUuid) group = 1 - group;
      this.detailMovGroups.push(group);
      lastUuid = uuid;
    }
  }

  closeDetail(): void {
    this.showDetailModal = false;
    this.detailPoliza    = null;
  }

  trackByMovIndex(index: number): number { return index; }

  openCreate(): void {
    this.editingId       = null;
    this.formTipo        = 'D';
    this.formFecha       = new Date().toISOString().slice(0, 10);
    this.formConcepto    = '';
    this.formFolio       = '';
    this.formMovimientos = [this.blankRow(), this.blankRow()];
    this.modalError      = null;
    this.showModal       = true;
  }

  openEdit(p: Poliza): void {
    this.editingId    = p.id;
    this.formTipo     = p.tipo;
    this.formFecha    = p.fecha;
    this.formConcepto = p.concepto;
    this.formFolio    = p.folio ?? '';
    this.modalError   = null;
    const buildRows = (movs: PolizaMovimiento[]) => movs.map(m => ({
      cuentaId: m.cuentaId, concepto: m.concepto, debe: m.debe, haber: m.haber,
      cuentaBusqueda: m.cuenta ? `${m.cuenta.codigo} — ${m.cuenta.nombre}` : String(m.cuentaId ?? ''),
      cuentaSugerencias: [], cfdiUuid: m.cfdiUuid ?? '', rfcTercero: m.rfcTercero ?? '',
    }));
    if (p.movimientos) { this.formMovimientos = buildRows(p.movimientos); this.showModal = true; }
    else {
      this.svc.getById(p.id).pipe(takeUntil(this.destroy$)).subscribe({
        next: (full) => { this.formMovimientos = buildRows(full.movimientos ?? []); this.showModal = true; },
      });
    }
  }

  closeModal(): void { this.showModal = false; this.editingId = null; this.modalError = null; }

  blankRow(): MovimientoRow {
    return { cuentaId: null, cuentaBusqueda: '', cuentaSugerencias: [], concepto: '', debe: '', haber: '', cfdiUuid: '', rfcTercero: '' };
  }

  addMovimiento(): void { this.formMovimientos.push(this.blankRow()); }
  removeMovimiento(i: number): void { this.formMovimientos.splice(i, 1); }

  buscarCuenta(row: MovimientoRow): void {
    const q = row.cuentaBusqueda.trim();
    if (q.length < 2) { row.cuentaSugerencias = []; return; }
    this.accountSvc.search(q).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => { row.cuentaSugerencias = res.slice(0, 8); },
      error: () => { row.cuentaSugerencias = []; },
    });
  }

  seleccionarCuenta(row: MovimientoRow, cuenta: AccountPlan): void {
    row.cuentaId = cuenta.id;
    row.cuentaBusqueda = `${cuenta.codigo} — ${cuenta.nombre}`;
    row.cuentaSugerencias = [];
  }

  guardarPoliza(): void {
    if (this.saving) return;
    this.modalError = null;
    const movimientos = this.formMovimientos
      .filter(m => m.cuentaId || m.concepto || Number(m.debe) || Number(m.haber))
      .map(m => ({ cuentaId: m.cuentaId, concepto: m.concepto, debe: Number(m.debe) || 0, haber: Number(m.haber) || 0, cfdiUuid: m.cfdiUuid || null, rfcTercero: m.rfcTercero || null }));
    const payload: any = {
      tipo: this.formTipo, fecha: this.formFecha, concepto: this.formConcepto,
      folio: this.formFolio || null, rfc: this.rfc, ejercicio: this.ejercicio, periodo: this.periodoActivo, movimientos,
    };
    this.saving = true;
    (this.editingId ? this.svc.update(this.editingId, payload) : this.svc.create(payload))
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (p) => {
          this.saving = false; this.closeModal();
          const idx = this.polizas.findIndex(x => x.id === p.id);
          if (idx >= 0) this.polizas[idx] = p; else this.loadPolizas(1);
        },
        error: (err) => { this.modalError = err?.error?.error || 'Error al guardar'; this.saving = false; },
      });
  }

  openConfirm(action: ConfirmAction, p: Poliza): void {
    this.confirmAction = action; this.confirmPoliza = p; this.confirmMotivo = ''; this.confirmError = null; this.showConfirm = true;
  }
  closeConfirm(): void { this.showConfirm = false; this.confirmPoliza = null; this.confirmError = null; }

  ejecutarAccion(): void {
    if (!this.confirmPoliza || !this.confirmAction || this.confirmLoading) return;
    this.confirmLoading = true; this.confirmError = null;
    const id = this.confirmPoliza.id;
    const req$ = this.confirmAction === 'contabilizar' ? this.svc.contabilizar(id)
      : this.confirmAction === 'cancelar' ? this.svc.cancelar(id, this.confirmMotivo || undefined)
      : this.svc.revertir(id, this.confirmMotivo || undefined);
    req$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.confirmLoading = false; this.closeConfirm();
        const idx = this.polizas.findIndex(x => x.id === p.id);
        if (idx >= 0) this.polizas = this.polizas.map((x, i) => i === idx ? p : x);
      },
      error: (err) => { this.confirmError = err?.error?.error || 'Error'; this.confirmLoading = false; },
    });
  }

  openXmlModal(): void { this.xmlTipoSolicitud = 'AF'; this.xmlNumOrden = ''; this.xmlNumTramite = ''; this.xmlError = null; this.showXmlModal = true; }
  closeXmlModal(): void { this.showXmlModal = false; this.xmlError = null; }

  descargarXmlSat(): void {
    if (!this.hasPeriodo || this.exportandoXml) return;
    this.exportandoXml = true; this.xmlError = null;
    this.svc.xmlSat({ rfc: this.rfc, ejercicio: this.ejercicio!, periodo: this.periodoActivo!, tipoSolicitud: this.xmlTipoSolicitud || 'AF', numOrden: this.xmlNumOrden || undefined, numTramite: this.xmlNumTramite || undefined })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (blob) => {
          const mes = String(this.periodoActivo).padStart(2, '0');
          const a   = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `Polizas_${this.ejercicio}_${mes}_${this.rfc}.xml`;
          a.click(); URL.revokeObjectURL(a.href);
          this.exportandoXml = false; this.closeXmlModal();
        },
        error: (err) => { this.xmlError = err?.error?.error || 'Error al generar XML'; this.exportandoXml = false; },
      });
  }

  openGenerar(): void { this.generarTipo = 'I'; this.generarResult = null; this.generarError = null; this.showGenerar = true; }
  closeGenerar(): void { this.showGenerar = false; this.generarResult = null; }

  ejecutarGenerar(): void {
    if (!this.hasPeriodo || this.generarLoading) return;
    this.generarLoading = true; this.generarError = null; this.generarResult = null;
    this.mappingSvc.generarYGuardar({ rfc: this.rfc, ejercicio: this.ejercicio!, periodo: this.periodoActivo!, tipoCfdi: this.generarTipo })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => { this.generarResult = res; this.generarLoading = false; this.loadPolizas(1); },
        error: (err) => { this.generarError = err?.error?.error || 'Error al generar'; this.generarLoading = false; },
      });
  }

  // ── Reglas contables ─────────────────────────────────────────────────────────

  loadRules(): void {
    this.rulesLoading = true; this.rulesError = null;
    this.mappingSvc.listRules().pipe(takeUntil(this.destroy$)).subscribe({
      next: (r) => { this.rules = r; this.rulesLoading = false; },
      error: (err) => { this.rulesError = err?.error?.error || 'Error al cargar reglas'; this.rulesLoading = false; },
    });
  }

  openCreateRule(): void {
    this.editingRuleId = null;
    this.ruleNombre = ''; this.ruleTipo = ''; this.ruleRfcEmisor = ''; this.ruleMetodoPago = ''; this.ruleFormaPago = '';
    this.ruleCuentaCargo = ''; this.ruleCuentaAbono = ''; this.ruleCuentaIva = ''; this.ruleCuentaIvaPPD = '';
    this.ruleCuentaIvaRetenido = ''; this.ruleCuentaIsrRetenido = ''; this.ruleCentroCosto = ''; this.rulePrioridad = 50; this.ruleIsActive = true;
    this.ruleError = null; this.showRuleModal = true;
  }

  openEditRule(r: CfdiMappingRule): void {
    this.editingRuleId = r.id;
    this.ruleNombre = r.nombre; this.ruleTipo = r.tipoComprobante ?? ''; this.ruleRfcEmisor = r.rfcEmisor ?? ''; this.ruleMetodoPago = r.metodoPago ?? ''; this.ruleFormaPago = r.formaPago ?? '';
    this.ruleCuentaCargo = r.cuentaCargo; this.ruleCuentaAbono = r.cuentaAbono; this.ruleCuentaIva = r.cuentaIva ?? ''; this.ruleCuentaIvaPPD = r.cuentaIvaPPD ?? '';
    this.ruleCuentaIvaRetenido = r.cuentaIvaRetenido ?? ''; this.ruleCuentaIsrRetenido = r.cuentaIsrRetenido ?? ''; this.ruleCentroCosto = r.centroCosto ?? ''; this.rulePrioridad = r.prioridad; this.ruleIsActive = r.isActive;
    this.ruleError = null; this.showRuleModal = true;
  }

  closeRuleModal(): void { this.showRuleModal = false; this.editingRuleId = null; this.ruleError = null; }

  guardarRule(): void {
    if (this.savingRule) return;
    this.ruleError = null;
    const data: Partial<CfdiMappingRule> = {
      nombre: this.ruleNombre, tipoComprobante: this.ruleTipo || null as any,
      rfcEmisor: this.ruleRfcEmisor || null, metodoPago: this.ruleMetodoPago || null, formaPago: this.ruleFormaPago || null,
      cuentaCargo: this.ruleCuentaCargo, cuentaAbono: this.ruleCuentaAbono,
      cuentaIva: this.ruleCuentaIva || null, cuentaIvaPPD: this.ruleCuentaIvaPPD || null,
      cuentaIvaRetenido: this.ruleCuentaIvaRetenido || null, cuentaIsrRetenido: this.ruleCuentaIsrRetenido || null,
      centroCosto: this.ruleCentroCosto || null, prioridad: this.rulePrioridad, isActive: this.ruleIsActive,
    };
    this.savingRule = true;
    (this.editingRuleId ? this.mappingSvc.updateRule(this.editingRuleId, data) : this.mappingSvc.createRule(data))
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: () => { this.savingRule = false; this.closeRuleModal(); this.loadRules(); },
        error: (err) => { this.ruleError = err?.error?.error || 'Error al guardar regla'; this.savingRule = false; },
      });
  }

  openDeleteRule(r: CfdiMappingRule): void { this.deletingRule = r; this.showDeleteRule = true; }
  closeDeleteRule(): void { this.showDeleteRule = false; this.deletingRule = null; }

  confirmarDeleteRule(): void {
    if (!this.deletingRule || this.deletingRuleLoading) return;
    this.deletingRuleLoading = true;
    this.mappingSvc.deleteRule(this.deletingRule.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.deletingRuleLoading = false; this.closeDeleteRule(); this.loadRules(); },
      error: () => { this.deletingRuleLoading = false; this.closeDeleteRule(); },
    });
  }

  // ── Balanza de comprobación ───────────────────────────────────────────────────

  loadBalanza(): void {
    if (!this.hasPeriodo) return;
    this.balanzaLoading = true; this.balanzaError = null;
    const params: any = { rfc: this.rfc, ejercicio: this.ejercicio!, periodo: this.periodoActivo! };
    if (this.balanzaTipoCfdi) params.tipoCfdi = this.balanzaTipoCfdi;
    this.mappingSvc.balanzaPreliminar(params).pipe(takeUntil(this.destroy$)).subscribe({
      next: (b) => { this.balanza = b; this.balanzaLoading = false; },
      error: (err) => { this.balanzaError = err?.error?.error || 'Error al generar balanza'; this.balanzaLoading = false; },
    });
  }

  // ── Balance general ───────────────────────────────────────────────────────────

  loadBalance(): void {
    if (!this.hasPeriodo) return;
    this.balanceLoading = true; this.balanceError = null;
    this.mappingSvc.balanceGeneral({ rfc: this.rfc, ejercicio: this.ejercicio!, periodo: this.periodoActivo! })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (b) => { this.balance = b; this.balanceLoading = false; },
        error: (err) => { this.balanceError = err?.error?.error || 'Error al generar balance'; this.balanceLoading = false; },
      });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  trackById(_: number, p: Poliza): number { return p.id; }

  tipoLabel(tipo: PolizaTipo): string { return this.tiposPoliza.find(t => t.value === tipo)?.label ?? tipo; }

  confirmLabel(): string {
    return { contabilizar: 'Contabilizar', cancelar: 'Cancelar', revertir: 'Revertir' }[this.confirmAction ?? 'contabilizar'] ?? '';
  }

  confirmRequiresMotivo(): boolean {
    return this.confirmAction === 'cancelar' || this.confirmAction === 'revertir';
  }

  movTotal(movs: PolizaMovimiento[] | undefined, campo: 'debe' | 'haber'): number {
    return (movs ?? []).reduce((s, m) => s + (Number(m[campo]) || 0), 0);
  }

  formatFecha(f: string): string {
    if (!f) return '—';
    return new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  fmt(n: number): string { return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  formatMonto(n: number | string | null | undefined): string { return this.fmt(Number(n) || 0); }

  min(a: number, b: number): number { return Math.min(a, b); }
  Math = Math;

  fmtPeriodoFecha(ejercicio: number | null, periodo: number | null): string {
    if (!ejercicio || !periodo) return '';
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio',
                   'agosto','septiembre','octubre','noviembre','diciembre'];
    const ultimoDia = new Date(ejercicio, periodo, 0).getDate();
    return `Al ${ultimoDia} de ${meses[periodo - 1]} de ${ejercicio}`;
  }

  movHasError(m: PolizaMovimiento): boolean {
    if (!m.cfdiUuid || !this.detailPoliza?.cfdiAlertMap) return false;
    return !!this.detailPoliza.cfdiAlertMap[m.cfdiUuid];
  }
}
