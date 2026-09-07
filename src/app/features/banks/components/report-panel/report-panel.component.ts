import {
  Component, OnInit, OnDestroy, Input, Output, EventEmitter, OnChanges, SimpleChanges,
} from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BankService, BankCard, BankFilter } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { EntidadActivaService } from '../../../../core/services/entidad-activa.service';
import {
  ReportFiltrosGuardadosService, ReportFiltrosGuardados,
} from '../../../../core/services/report-filtros-guardados.service';

@Component({
  standalone: false,
  selector: 'app-report-panel',
  templateUrl: './report-panel.component.html',
  styleUrls: ['./report-panel.component.css'],
})
export class ReportPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() visible                  = false;
  @Input() bankCards: BankCard[]    = [];
  @Input() fechaInicio              = '';
  @Input() fechaFin                 = '';
  @Input() fechaAplicacionInicio    = '';
  @Input() fechaAplicacionFin       = '';
  @Input() fechaImportacionInicio   = '';
  @Input() fechaImportacionFin      = '';

  @Output() fechaInicioChange            = new EventEmitter<string>();
  @Output() fechaFinChange               = new EventEmitter<string>();
  @Output() fechaAplicacionInicioChange  = new EventEmitter<string>();
  @Output() fechaAplicacionFinChange     = new EventEmitter<string>();
  @Output() fechaImportacionInicioChange = new EventEmitter<string>();
  @Output() fechaImportacionFinChange    = new EventEmitter<string>();
  @Output() openCalendar = new EventEmitter<{ context: 'report' | 'report-aplicacion' | 'report-importacion'; anchor: HTMLElement }>();
  @Output() closed       = new EventEmitter<void>();

  // ── Constantes ──────────────────────────────────────────────────────────
  readonly REPORT_ALL_STATUSES = ['no_identificado', 'identificado', 'otros', 'reclasificado'];
  readonly REPORT_ALL_TIPOS    = ['deposito', 'retiro'];
  readonly COL_KEYS: string[]  = ['saldoErp', 'folioFiscal', 'formaPago', 'retencion', 'ficha', 'regla', 'fechaImportacion'];
  readonly COL_LABELS: Record<string, string> = {
    saldoErp:   'Saldo ERP',
    folioFiscal:'Folio fiscal',
    formaPago:  'Forma de pago',
    retencion:  'Retención',
    ficha:      'Ficha',
    regla:      'Regla aplicada',
    fechaImportacion: 'Fecha de importación',
  };

  // ── Estado ───────────────────────────────────────────────────────────────
  reportBancos:          string[] = [];
  reportStatuses:        string[] = [...this.REPORT_ALL_STATUSES];
  reportTipos:           string[] = [...this.REPORT_ALL_TIPOS];
  reportCatOptions:      (string | null)[] = [];
  reportIdOptions:       { userId: string; nombre: string }[] = [];
  reportCategorias:      string[] = [];
  reportIdentificadoPor: string[] = [];
  reportColumnas:        string[] = ['saldoErp', 'folioFiscal', 'formaPago'];

  importeMin: number | null = null;
  importeMax: number | null = null;
  folioFilter: 'todos' | 'con' | 'sin' = 'todos';
  fichaFilter: 'todos' | 'con' | 'sin' = 'todos';

  exportingReport = false;
  reportError: string | null = null;

  // ── Filtros guardados (localStorage, por usuario+entidad) ────────────────
  // 2026-09-07: aviso al exportar si los filtros en pantalla difieren de los
  // guardados; el aviso nunca bloquea la exportación, solo decide si además
  // se persiste la configuración actual (ver exportReport()/_ejecutarExport()).
  showFiltrosModal = false;
  filtrosModalMode: 'guardar' | 'actualizar' = 'guardar';
  private _filtrosPendientes: ReportFiltrosGuardados | null = null;

  private destroy$ = new Subject<void>();

  // Cancela SOLO las llamadas de _loadReportFilters() en vuelo, independiente
  // de destroy$ (que vive toda la vida del componente porque <app-report-panel>
  // nunca se destruye entre aperturas — solo se oculta por CSS). Sin esto, una
  // respuesta lenta de una apertura anterior puede llegar después de una más
  // reciente y pisar reportCatOptions/reportCategorias con datos del banco
  // equivocado (2026-09-07, bug real detectado en review de confiabilidad).
  private _reportFiltersReload$ = new Subject<void>();

  constructor(
    private bankService: BankService,
    private authService: AuthService,
    private entidadActivaService: EntidadActivaService,
    private filtrosGuardadosService: ReportFiltrosGuardadosService,
  ) {}

  ngOnInit(): void {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this._init();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this._reportFiltersReload$.complete();
  }

  private _init(): void {
    // Si hay una configuración guardada para este usuario+entidad, se carga
    // en vez de los defaults de fábrica (2026-09-07). Los bancos guardados se
    // filtran contra los bankCards disponibles ahora mismo — si ya no queda
    // ninguno vigente (banco desactivado/renombrado), se cae a "todos".
    const saved = this.filtrosGuardadosService.cargar(this._userId, this._entidadRfc);
    const bancosDisponibles = this.bankCards.map(c => c.banco);

    if (saved) {
      const bancosGuardados = saved.bancos.filter(b => bancosDisponibles.includes(b));
      this.reportBancos   = bancosGuardados.length ? bancosGuardados : bancosDisponibles;
      this.reportStatuses = [...saved.statuses];
      this.reportTipos    = [...saved.tipos];
      this.reportColumnas = [...saved.columnas];
      this.importeMin     = saved.importeMin;
      this.importeMax     = saved.importeMax;
      this.folioFilter    = saved.folioFilter;
      this.fichaFilter    = saved.fichaFilter;
    } else {
      this.reportBancos   = bancosDisponibles;
      this.reportStatuses = [...this.REPORT_ALL_STATUSES];
      this.reportTipos    = [...this.REPORT_ALL_TIPOS];
      this.reportColumnas = ['saldoErp', 'folioFiscal', 'formaPago'];
      this.importeMin     = null;
      this.importeMax     = null;
      this.folioFilter    = 'todos';
      this.fichaFilter    = 'todos';
    }

    this.reportCatOptions      = [];
    this.reportIdOptions       = [];
    this.reportError           = null;
    this.showFiltrosModal      = false;
    this._loadReportFilters(saved);
  }

  private get _userId(): string {
    return this.authService.currentUser?.id || '';
  }

  private get _entidadRfc(): string {
    return this.entidadActivaService.snapshot?.rfc || '';
  }

  // ── Getters de fecha ─────────────────────────────────────────────────────

  get reportDateLabel(): string {
    const fmt = (s: string) => s.split('-').reverse().join('/');
    if (this.fechaInicio && this.fechaFin)
      return `${fmt(this.fechaInicio)} – ${fmt(this.fechaFin)}`;
    if (this.fechaInicio) return `Desde ${fmt(this.fechaInicio)}`;
    if (this.fechaFin)   return `Hasta ${fmt(this.fechaFin)}`;
    return 'Cualquier fecha';
  }

  get reportFechaAplicacionLabel(): string {
    const fmt = (s: string) => s.split('-').reverse().join('/');
    if (this.fechaAplicacionInicio && this.fechaAplicacionFin)
      return `${fmt(this.fechaAplicacionInicio)} – ${fmt(this.fechaAplicacionFin)}`;
    if (this.fechaAplicacionInicio) return `Desde ${fmt(this.fechaAplicacionInicio)}`;
    if (this.fechaAplicacionFin)   return `Hasta ${fmt(this.fechaAplicacionFin)}`;
    return 'Cualquier fecha';
  }

  get reportFechaImportacionLabel(): string {
    const fmt = (s: string) => s.split('-').reverse().join('/');
    if (this.fechaImportacionInicio && this.fechaImportacionFin)
      return `${fmt(this.fechaImportacionInicio)} – ${fmt(this.fechaImportacionFin)}`;
    if (this.fechaImportacionInicio) return `Desde ${fmt(this.fechaImportacionInicio)}`;
    if (this.fechaImportacionFin)   return `Hasta ${fmt(this.fechaImportacionFin)}`;
    return 'Cualquier fecha';
  }

  // ── Digest ───────────────────────────────────────────────────────────────

  get digestText(): string {
    const parts: string[] = [];
    const fmt = (s: string) => s.split('-').reverse().join('/');

    if (this.reportAllBancosChecked)   parts.push('Todos los bancos');
    else if (!this.reportBancos.length) parts.push('Sin banco seleccionado');
    else                               parts.push(this.reportBancos.join(', '));

    if (this.fechaInicio || this.fechaFin) {
      if (this.fechaInicio && this.fechaFin)
        parts.push(`${fmt(this.fechaInicio)}–${fmt(this.fechaFin)}`);
      else if (this.fechaInicio) parts.push(`desde ${fmt(this.fechaInicio)}`);
      else                       parts.push(`hasta ${fmt(this.fechaFin)}`);
    } else {
      parts.push('cualquier fecha');
    }

    if (!this.reportAllTiposChecked && this.reportTipos.length) {
      parts.push(
        this.reportTipos.includes('deposito') && !this.reportTipos.includes('retiro')
          ? 'solo depósitos' : 'solo retiros',
      );
    }

    if (this.folioFilter !== 'todos')
      parts.push(this.folioFilter === 'con' ? 'con folio fiscal' : 'sin folio fiscal');

    if (this.fichaFilter !== 'todos')
      parts.push(this.fichaFilter === 'con' ? 'con ficha' : 'sin ficha');

    if (this.importeMin != null || this.importeMax != null) {
      const fmtNum = (v: number) => v.toLocaleString('es-MX');
      if (this.importeMin != null && this.importeMax != null)
        parts.push(`$${fmtNum(this.importeMin)}–$${fmtNum(this.importeMax)}`);
      else if (this.importeMin != null)
        parts.push(`desde $${fmtNum(this.importeMin)}`);
      else
        parts.push(`hasta $${fmtNum(this.importeMax!)}`);
    }

    return parts.join(' · ');
  }

  get digestIsCustom(): boolean {
    return !this.reportAllBancosChecked
      || !!(this.fechaInicio || this.fechaFin || this.fechaAplicacionInicio || this.fechaAplicacionFin)
      || !this.reportAllTiposChecked
      || !this.reportAllStatusesChecked
      || this.folioFilter !== 'todos'
      || this.fichaFilter !== 'todos'
      || this.importeMin != null
      || this.importeMax != null;
  }

  // ── Bancos ───────────────────────────────────────────────────────────────

  get reportSingleBanco(): string | null {
    return this.reportBancos.length === 1 ? this.reportBancos[0] : null;
  }

  get reportAllBancosChecked(): boolean {
    return this.reportBancos.length === this.bankCards.length;
  }

  toggleAllReportBancos(): void {
    this.reportBancos = this.reportAllBancosChecked ? [] : this.bankCards.map(c => c.banco);
    this._loadReportFilters();
  }

  toggleReportBanco(banco: string): void {
    const i = this.reportBancos.indexOf(banco);
    i === -1 ? this.reportBancos.push(banco) : this.reportBancos.splice(i, 1);
    this._loadReportFilters();
  }

  // ── Carga dinámica ───────────────────────────────────────────────────────

  // `restore`: solo se pasa desde _init() cuando había una configuración
  // guardada — las categorías/identificadoPor guardados se restauran
  // filtrados contra las opciones vigentes (una categoría/usuario guardado
  // que ya no aparece en las opciones actuales simplemente se descarta). Las
  // llamadas manuales (toggleReportBanco/toggleAllReportBancos) NO pasan este
  // parámetro: ahí siempre debe aplicar el default de "todas seleccionadas".
  private _loadReportFilters(restore?: ReportFiltrosGuardados | null): void {
    // Cancela cualquier carga anterior aún en vuelo antes de disparar la nueva
    // — evita que una respuesta lenta de una apertura/banco previo llegue
    // después y pise el estado de la apertura/banco actual.
    this._reportFiltersReload$.next();

    this.reportCatOptions      = [];
    this.reportIdOptions       = [];
    this.reportCategorias      = [];
    this.reportIdentificadoPor = [];

    if (!this.reportBancos.length) return;

    const bancoParam = this.reportBancos.length < this.bankCards.length
      ? this.reportBancos.join(',')
      : undefined;

    this.bankService.listCategories(bancoParam)
      .pipe(takeUntil(this._reportFiltersReload$), takeUntil(this.destroy$))
      .subscribe({
        next: (cats) => {
          this.reportCatOptions = cats;
          if (restore) {
            const validos = new Set(cats.map(c => c ?? '__null__'));
            this.reportCategorias = restore.categorias.filter(c => validos.has(c));
          } else {
            this.reportCategorias = cats.map(c => c ?? '__null__');
          }
        },
      });

    this.bankService.listIdentificadores(bancoParam)
      .pipe(takeUntil(this._reportFiltersReload$), takeUntil(this.destroy$))
      .subscribe({
        next: (ids) => {
          this.reportIdOptions = ids;
          if (restore) {
            const validos = new Set(ids.map(i => i.userId));
            this.reportIdentificadoPor = restore.identificadoPor.filter(id => validos.has(id));
          } else {
            this.reportIdentificadoPor = ids.map(i => i.userId);
          }
        },
      });
  }

  // ── Estado ───────────────────────────────────────────────────────────────

  get reportAllStatusesChecked(): boolean {
    return this.reportStatuses.length === this.REPORT_ALL_STATUSES.length;
  }
  toggleAllReportStatuses(): void {
    this.reportStatuses = this.reportAllStatusesChecked ? [] : [...this.REPORT_ALL_STATUSES];
  }
  toggleReportStatus(s: string): void {
    const i = this.reportStatuses.indexOf(s);
    i === -1 ? this.reportStatuses.push(s) : this.reportStatuses.splice(i, 1);
  }

  // ── Tipo ─────────────────────────────────────────────────────────────────

  get reportAllTiposChecked(): boolean {
    return this.reportTipos.length === this.REPORT_ALL_TIPOS.length;
  }
  toggleAllReportTipos(): void {
    this.reportTipos = this.reportAllTiposChecked ? [] : [...this.REPORT_ALL_TIPOS];
  }
  toggleReportTipo(t: string): void {
    const i = this.reportTipos.indexOf(t);
    i === -1 ? this.reportTipos.push(t) : this.reportTipos.splice(i, 1);
  }

  // ── Importe ──────────────────────────────────────────────────────────────

  onImporteMinChange(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.importeMin = v ? Number(v) : null;
  }
  onImporteMaxChange(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.importeMax = v ? Number(v) : null;
  }

  // ── Folio / Ficha ────────────────────────────────────────────────────────

  selectFolioFilter(v: 'todos' | 'con' | 'sin'): void { this.folioFilter = v; }
  selectFichaFilter(v: 'todos' | 'con' | 'sin'): void { this.fichaFilter = v; }

  // ── Categorías ───────────────────────────────────────────────────────────

  get reportAllCatsChecked(): boolean {
    return this.reportCatOptions.length > 0
      && this.reportCategorias.length === this.reportCatOptions.length;
  }
  toggleAllReportCats(): void {
    this.reportCategorias = this.reportAllCatsChecked
      ? [] : this.reportCatOptions.map(c => c ?? '__null__');
  }
  toggleReportCategoria(val: string): void {
    const i = this.reportCategorias.indexOf(val);
    i === -1 ? this.reportCategorias.push(val) : this.reportCategorias.splice(i, 1);
  }

  // ── Identificado por ─────────────────────────────────────────────────────

  get reportAllIdsChecked(): boolean {
    return this.reportIdOptions.length > 0
      && this.reportIdentificadoPor.length === this.reportIdOptions.length;
  }
  toggleAllReportIds(): void {
    this.reportIdentificadoPor = this.reportAllIdsChecked
      ? [] : this.reportIdOptions.map(i => i.userId);
  }
  toggleReportIdentificador(id: string): void {
    const i = this.reportIdentificadoPor.indexOf(id);
    i === -1 ? this.reportIdentificadoPor.push(id) : this.reportIdentificadoPor.splice(i, 1);
  }

  // ── Columnas ─────────────────────────────────────────────────────────────

  get reportColsCount(): number { return this.reportColumnas.length; }
  hasColumna(key: string): boolean { return this.reportColumnas.includes(key); }
  toggleColumna(key: string): void {
    const i = this.reportColumnas.indexOf(key);
    i === -1 ? this.reportColumnas.push(key) : this.reportColumnas.splice(i, 1);
  }

  // ── Calendar ─────────────────────────────────────────────────────────────

  onDateBtnClick(context: 'report' | 'report-aplicacion' | 'report-importacion', anchor: HTMLElement): void {
    this.openCalendar.emit({ context, anchor });
  }

  clearPeriodo(): void {
    this.fechaInicioChange.emit('');
    this.fechaFinChange.emit('');
  }

  clearAplicacion(): void {
    this.fechaAplicacionInicioChange.emit('');
    this.fechaAplicacionFinChange.emit('');
  }

  clearImportacion(): void {
    this.fechaImportacionInicioChange.emit('');
    this.fechaImportacionFinChange.emit('');
  }

  // ── Filtros guardados ────────────────────────────────────────────────────

  private _filtrosActualesComoGuardado(): ReportFiltrosGuardados {
    return {
      bancos:          [...this.reportBancos],
      statuses:        [...this.reportStatuses],
      tipos:           [...this.reportTipos],
      categorias:      [...this.reportCategorias],
      identificadoPor: [...this.reportIdentificadoPor],
      columnas:        [...this.reportColumnas],
      importeMin:      this.importeMin,
      importeMax:      this.importeMax,
      folioFilter:     this.folioFilter,
      fichaFilter:     this.fichaFilter,
    };
  }

  /** El usuario eligió "Guardar"/"Actualizar" en el modal de aviso. */
  onFiltrosModalGuardar(): void {
    if (this._filtrosPendientes) {
      this.filtrosGuardadosService.guardar(this._userId, this._entidadRfc, this._filtrosPendientes);
    }
    this.showFiltrosModal = false;
    this._ejecutarExport();
  }

  /** El usuario eligió "Volver" en el modal — no guarda/actualiza, pero igual exporta. */
  onFiltrosModalVolver(): void {
    this.showFiltrosModal = false;
    this._ejecutarExport();
  }

  // ── Exportar ─────────────────────────────────────────────────────────────

  exportReport(): void {
    if (this.exportingReport || !this.reportBancos.length) return;

    // El aviso de guardar/actualizar filtros es solo sobre PERSISTIR la
    // configuración — nunca bloquea la exportación en sí (2026-09-07, decisión
    // confirmada con el usuario). Si no hay diferencias contra lo guardado (o
    // no aplica ningún aviso todavía) se exporta directo.
    const actuales  = this._filtrosActualesComoGuardado();
    const guardados = this.filtrosGuardadosService.cargar(this._userId, this._entidadRfc);
    this._filtrosPendientes = actuales;

    if (!guardados) {
      this.filtrosModalMode = 'guardar';
      this.showFiltrosModal = true;
      return;
    }
    if (!this.filtrosGuardadosService.sonIguales(actuales, guardados)) {
      this.filtrosModalMode = 'actualizar';
      this.showFiltrosModal = true;
      return;
    }
    this._ejecutarExport();
  }

  private _ejecutarExport(): void {
    this.exportingReport = true;
    this.reportError     = null;

    const allSts    = this.reportStatuses.length === this.REPORT_ALL_STATUSES.length;
    const allTps    = this.reportTipos.length    === this.REPORT_ALL_TIPOS.length;
    const allCts    = !this.reportCatOptions.length
      || this.reportCategorias.length === this.reportCatOptions.length;
    const allIds    = !this.reportIdOptions.length
      || this.reportIdentificadoPor.length === this.reportIdOptions.length;
    const allBancos = this.reportBancos.length === this.bankCards.length;

    const filters: BankFilter = {
      banco:                 allBancos ? undefined : this.reportBancos.join(','),
      fechaInicio:           this.fechaInicio           || undefined,
      fechaFin:              this.fechaFin              || undefined,
      fechaAplicacionInicio: this.fechaAplicacionInicio || undefined,
      fechaAplicacionFin:    this.fechaAplicacionFin    || undefined,
      fechaImportacionInicio: this.fechaImportacionInicio || undefined,
      fechaImportacionFin:    this.fechaImportacionFin    || undefined,
      status:                allSts ? undefined : this.reportStatuses.join(','),
      tipo:                  allTps ? undefined : this.reportTipos.join(','),
      importeMin:            this.importeMin ?? undefined,
      importeMax:            this.importeMax ?? undefined,
      folioFiscal:           this.folioFilter !== 'todos' ? this.folioFilter : undefined,
      ficha:                 this.fichaFilter !== 'todos' ? this.fichaFilter : undefined,
      categorias:            allCts ? undefined : this.reportCategorias.join(','),
      identificadoPor:       allIds ? undefined : this.reportIdentificadoPor.join(','),
      columnas:              this.reportColumnas.join(','),
      sortBy: 'fecha', sortDir: 'asc',
    };

    const bancoLabel = allBancos
      ? 'todos'
      : (this.reportBancos.length === 1 ? this.reportBancos[0] : 'seleccion');

    this.bankService.exportMovements(filters).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url   = URL.createObjectURL(blob);
        const a     = document.createElement('a');
        const fecha = new Date().toISOString().slice(0, 10);
        a.href     = url;
        a.download = `reporte-${bancoLabel}-${fecha}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportingReport = false;
      },
      error: (err) => {
        this.exportingReport = false;
        // Como exportMovements pide responseType:'blob' (para recibir el .xlsx en
        // éxito), Angular también entrega el cuerpo de ERROR como Blob en vez de
        // JSON ya parseado — hay que leerlo como texto y parsear a mano para
        // mostrar el mensaje real del backend en vez de un genérico. Mismo patrón
        // que mostrarErrorZip() en poliza-list.component.ts.
        if (err?.error instanceof Blob) {
          err.error.text().then((text: string) => {
            let msg = 'Error al generar el reporte';
            try { msg = JSON.parse(text)?.error || msg; } catch { /* respuesta no era JSON */ }
            this.reportError = msg;
          });
          return;
        }
        this.reportError = err?.error?.error || err?.message || 'Error al generar el reporte';
      },
    });
  }
}
