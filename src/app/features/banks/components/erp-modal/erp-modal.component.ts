import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import {
  BankService, BankMovement, BankStatus, ErpCxC, ErpLink,
} from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  standalone: false,
  selector: 'app-erp-modal',
  templateUrl: './erp-modal.component.html',
  styleUrls: ['./erp-modal.component.css'],
})
export class ErpModalComponent implements OnInit, OnChanges, OnDestroy {
  @Input() movement: BankMovement | null = null;

  @Output() closed          = new EventEmitter<void>();
  @Output() saved           = new EventEmitter<{ folio: string; hasErpIds: boolean }>();
  @Output() closeCobroPanel = new EventEmitter<void>();
  @Output() openCobro       = new EventEmitter<void>();
  @Output() movementUpdated = new EventEmitter<BankMovement>();

  showErpCloseConfirm     = false;
  erpSearch               = '';
  erpCxcList: ErpCxC[]   = [];
  erpLoading              = false;
  erpError: string | null = null;
  erpSaving               = false;
  erpPage                 = 1;
  erpTotalPaginas         = 1;
  erpTotalRegistros       = 0;
  private erpCxcCache     = new Map<string, ErpCxC>();
  erpSoloPendientes       = true;
  erpIdsOriginal: string[] = [];  // public: read by parent via @ViewChild for cobro flow

  fichaInput               = '';
  savingFicha              = false;
  deletingFicha            = false;
  fichaError: string | null = null;

  erpMes:  number = new Date().getMonth() + 1;
  erpAnio: number = new Date().getFullYear();
  readonly erpMeses = [
    { value: 1,  label: 'Enero'      }, { value: 2,  label: 'Febrero'   },
    { value: 3,  label: 'Marzo'      }, { value: 4,  label: 'Abril'     },
    { value: 5,  label: 'Mayo'       }, { value: 6,  label: 'Junio'     },
    { value: 7,  label: 'Julio'      }, { value: 8,  label: 'Agosto'    },
    { value: 9,  label: 'Septiembre' }, { value: 10, label: 'Octubre'   },
    { value: 11, label: 'Noviembre'  }, { value: 12, label: 'Diciembre' },
  ];
  readonly erpAnios: number[] = (() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1];
  })();

  private cobroActivado = false;
  private destroy$      = new Subject<void>();
  readonly erpSearch$   = new Subject<string>();

  constructor(
    private bankService: BankService,
    public  auth:        AuthService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    // Re-initialize when a new movement is assigned (modal opens).
    // ngOnChanges fires before ngOnInit on first render, when movement is still null — initModal() guards against that.
    if (changes['movement'] && this.movement) {
      this.initModal();
    }
  }

  ngOnInit(): void {
    this.erpSearch$.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadErpCuentas(1));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get erpFechaDesde(): string { return this.isoFirstDay(this.erpAnio, this.erpMes); }
  get erpFechaHasta(): string { return this.isoLastDay(this.erpAnio, this.erpMes); }

  private isoFirstDay(year: number, month: number): string {
    const mm = String(month).padStart(2, '0');
    return `${year}-${mm}-01T00:00:00Z`;
  }

  private isoLastDay(year: number, month: number): string {
    const lastDay = new Date(year, month, 0).getDate();
    const mm = String(month).padStart(2, '0');
    const dd = String(lastDay).padStart(2, '0');
    return `${year}-${mm}-${dd}T23:59:59Z`;
  }

  get filteredCxC(): ErpCxC[] { return this.erpCxcList; }

  get hasUnsavedCxC(): boolean {
    const curr = (this.movement?.erpIds ?? []).slice().sort().join(',');
    const orig = [...this.erpIdsOriginal].sort().join(',');
    return curr !== orig;
  }

  get hasUnsavedFicha(): boolean { return this.fichaInput.trim() !== ''; }

  // Called by parent after setting [movement] input to initialize state
  initModal(): void {
    if (!this.movement) return;
    this.erpIdsOriginal    = [...(this.movement.erpIds ?? [])];
    this.erpSearch         = '';
    this.erpSaving         = false;
    this.erpPage           = 1;
    this.erpTotalPaginas   = 1;
    this.erpCxcCache.clear();
    this.fichaInput        = '';
    this.savingFicha       = false;
    this.deletingFicha     = false;
    this.fichaError        = null;
    this.showErpCloseConfirm = false;
    this.loadErpCuentas(1);
  }

  closeErpModal(): void {
    if (this.hasUnsavedCxC || this.hasUnsavedFicha) {
      this.showErpCloseConfirm = true;
      return;
    }
    this._doCloseErpModal();
  }

  discardErpChanges(): void {
    this.showErpCloseConfirm = false;
    this._doCloseErpModal();
  }

  private _doCloseErpModal(): void {
    if (this.movement) {
      this.movement.erpIds = [...this.erpIdsOriginal];
    }
    this.erpCxcList          = [];
    this.erpError            = null;
    this.erpSaving           = false;
    this.erpCxcCache.clear();
    this.fichaInput          = '';
    this.savingFicha         = false;
    this.deletingFicha       = false;
    this.fichaError          = null;
    this.showErpCloseConfirm = false;
    this.closed.emit();
  }

  getCxcFromCache(id: string): ErpCxC | undefined { return this.erpCxcCache.get(id); }

  // Public: parent calls this (via @ViewChild) before confirmErp() in cobro success flow
  activateCobro(): void { this.cobroActivado = true; }

  private _cobroSaldosErp: { saldosActual: Record<string, number>; saldosPagado: Record<string, number> } | null = null;

  // Recibe el saldo restante (saldosActual) y el monto acumulado de transferencias
  // (saldosPagado) por CxC calculados en el cobro panel.
  // confirmErp() lo consume una sola vez para actualizar cada erpLink.
  setCobroSaldosErp(saldos: { saldosActual: Record<string, number>; saldosPagado: Record<string, number> }): void {
    this._cobroSaldosErp = saldos;
  }

  // Public: parent calls this (via @ViewChild) from cobro panel's apply-success handler
  confirmErp(): void {
    if (!this.movement || this.erpSaving) return;
    this.erpSaving = true;
    const mov = this.movement;
    const ids  = [...(mov.erpIds ?? [])];

    const cobroSaldos = this._cobroSaldosErp;
    this._cobroSaldosErp = null;

    const erpLinks: ErpLink[] = ids.map(erpId => {
      const overrideActual = cobroSaldos?.saldosActual?.[erpId];
      const overridePagado = cobroSaldos?.saldosPagado?.[erpId];
      const cached = this.erpCxcCache.get(erpId);
      if (cached) {
        return {
          erpId,
          saldoActual:  overrideActual  !== undefined ? overrideActual  : cached.saldoActual,
          saldoPagado:  overridePagado  !== undefined ? overridePagado  : null,
          folioFiscal:  cached.folioFiscal ?? null,
          total:        cached.total,
          serie:        cached.serie ?? null,
          folioExterno: cached.folioExterno ?? null,
          tipoPago:     cached.tipoPago ?? null,
        };
      }
      const inPage = this.erpCxcList.find(c => c.id === erpId);
      if (inPage) {
        return {
          erpId,
          saldoActual:  overrideActual  !== undefined ? overrideActual  : inPage.saldoActual,
          saldoPagado:  overridePagado  !== undefined ? overridePagado  : null,
          folioFiscal:  inPage.folioFiscal ?? null,
          total:        inPage.total,
          serie:        inPage.serie ?? null,
          folioExterno: inPage.folioExterno ?? null,
          tipoPago:     inPage.tipoPago ?? null,
        };
      }
      const prev = (mov.erpLinks ?? []).find((l: ErpLink) => l.erpId === erpId);
      if (prev) {
        if (overrideActual !== undefined || overridePagado !== undefined) {
          return {
            ...prev,
            ...(overrideActual !== undefined && { saldoActual: overrideActual }),
            ...(overridePagado !== undefined && { saldoPagado: overridePagado }),
          };
        }
        return prev;
      }

      console.warn(`[confirmErp] erpId ${erpId} no encontrado en cache, lista ni links previos`);
      return { erpId, saldoActual: overrideActual ?? 0, saldoPagado: overridePagado ?? null, folioFiscal: null, total: 0 };
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
          mov.identificadoPor = res.identificadoPor ?? [];
          this.erpIdsOriginal = [...res.erpIds];
          this.erpSaving      = false;
          this.erpCxcList     = [];
          this.erpCxcCache.clear();
          if (this.cobroActivado) {
            this.cobroActivado = false;
            this.closeCobroPanel.emit();
          }
          this.saved.emit({ folio: mov.folio ?? '', hasErpIds: res.erpIds?.length > 0 });
        },
        error: () => {
          this.erpSaving     = false;
          this.cobroActivado = false;
        },
      });
  }

  private parseErpSearch(search: string): { serieExterna: string; folioExterno: string } {
    const s = search.trim();
    if (!s) return { serieExterna: '', folioExterno: '' };
    const idx = s.indexOf('-');
    if (idx === -1) return { serieExterna: '', folioExterno: s };
    return { serieExterna: s.slice(0, idx), folioExterno: s.slice(idx + 1) };
  }

  loadErpCuentas(page = 1): void {
    this.erpLoading = true;
    this.erpError   = null;
    this.erpPage    = page;

    const s = this.erpSearch.trim();
    let serieExterna = '', folioExterno = '', nombrePersona = '';
    if (s) {
      if (s.includes('-')) {
        ({ serieExterna, folioExterno } = this.parseErpSearch(s));
      } else if (/^\d+$/.test(s)) {
        folioExterno = s;
      } else {
        nombrePersona = s;
      }
    }
    this.bankService.listErpCuentas(
      this.erpFechaDesde, this.erpFechaHasta,
      this.erpSoloPendientes, page,
      serieExterna, folioExterno, nombrePersona,
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.erpCxcList        = res.data;
        this.erpPage           = res.pagination.page;
        this.erpTotalPaginas   = res.pagination.totalPaginas ?? 1;
        this.erpTotalRegistros = res.pagination.total ?? 0;
        this.erpLoading        = false;
      },
      error: (err) => {
        this.erpError   = err?.error?.error || 'Error al consultar el ERP';
        this.erpLoading = false;
      },
    });
  }

  erpPrevPage(): void { if (this.erpPage > 1) this.loadErpCuentas(this.erpPage - 1); }
  erpNextPage(): void { if (this.erpPage < this.erpTotalPaginas) this.loadErpCuentas(this.erpPage + 1); }

  isCxCLinked(id: string): boolean {
    return (this.movement?.erpIds ?? []).includes(id);
  }

  toggleCxC(id: string): void {
    if (!this.movement) return;
    const ids = this.movement.erpIds ?? [];
    if (ids.includes(id)) {
      this.movement.erpIds = ids.filter(x => x !== id);
      this.erpCxcCache.delete(id);
    } else {
      this.movement.erpIds = [...ids, id];
      const cxc = this.erpCxcList.find(c => c.id === id);
      if (cxc) this.erpCxcCache.set(id, cxc);
    }
  }

  unlinkCxC(id: string, event: Event): void {
    event.stopPropagation();
    if (!this.movement) return;
    this.movement.erpIds = (this.movement.erpIds ?? []).filter(x => x !== id);
    this.erpCxcCache.delete(id);
  }

  erpLinkLabel(eid: string): string {
    const folio = (serie: string | null | undefined, fe: string | null | undefined) =>
      serie && fe ? `${serie}-${fe}` : null;

    const cached     = this.erpCxcCache.get(eid);
    const cachedFolio = folio(cached?.serie, cached?.folioExterno);
    if (cachedFolio) {
      return cached?.nombrePersona ? `${cachedFolio} · ${cached.nombrePersona}` : cachedFolio;
    }

    const fromLinks  = (this.movement?.erpLinks ?? []).find((l: ErpLink) => l.erpId === eid);
    const linkFolio  = folio(fromLinks?.serie, fromLinks?.folioExterno);
    if (linkFolio) return linkFolio;

    const fromList   = this.erpCxcList.find(c => c.id === eid);
    const listFolio  = folio(fromList?.serie, fromList?.folioExterno);
    if (listFolio) {
      return fromList?.nombrePersona ? `${listFolio} · ${fromList.nombrePersona}` : listFolio;
    }

    return '—';
  }

  erpLinkTieneRetencion(eid: string): boolean {
    return (this.movement?.erpLinks ?? [])
      .some((l: ErpLink) => l.erpId === eid && l.tieneRetencion);
  }

  saveFicha(): void {
    if (!this.movement || this.savingFicha) return;
    const ficha = this.fichaInput.trim();
    if (!ficha) { this.fichaError = 'Ingresa el número de ficha'; return; }
    this.savingFicha = true;
    this.fichaError  = null;

    this.bankService.setFicha(this.movement._id, ficha).subscribe({
      next: (res: { _id: string; status: BankStatus; ficha: string; fichaBy: string | null; fichaNombre: string | null; fichaAt: string | null }) => {
        if (this.movement) {
          this.movement.ficha       = res.ficha;
          this.movement.fichaBy     = res.fichaBy;
          this.movement.fichaNombre = res.fichaNombre;
          this.movement.fichaAt     = res.fichaAt;
          this.movement.status      = res.status;
          this.movementUpdated.emit(this.movement);
        }
        this.fichaInput  = '';
        this.savingFicha = false;
      },
      error: (err: { error?: { error?: string } }) => {
        this.fichaError  = err?.error?.error || 'Error al registrar la ficha';
        this.savingFicha = false;
      },
    });
  }

  canDeleteFicha(): boolean {
    if (!this.movement?.ficha) return false;
    if (this.auth.hasPermission('banks:admin')) return true;
    const userId = this.auth.currentUser?.id ?? null;
    return !!userId && this.movement.fichaBy === userId;
  }

  deleteFicha(): void {
    if (!this.movement || this.deletingFicha) return;
    this.deletingFicha = true;
    this.fichaError    = null;

    this.bankService.deleteFicha(this.movement._id).subscribe({
      next: (res: { _id: string; status: BankStatus; ficha: null; fichaBy: null; fichaNombre: null; fichaAt: null }) => {
        if (this.movement) {
          this.movement.ficha       = res.ficha;
          this.movement.fichaBy     = res.fichaBy;
          this.movement.fichaNombre = res.fichaNombre;
          this.movement.fichaAt     = res.fichaAt;
          this.movement.status      = res.status;
          this.movementUpdated.emit(this.movement);
        }
        this.deletingFicha = false;
      },
      error: (err: { error?: { error?: string } }) => {
        this.fichaError    = err?.error?.error || 'Error al eliminar la ficha';
        this.deletingFicha = false;
      },
    });
  }
}
