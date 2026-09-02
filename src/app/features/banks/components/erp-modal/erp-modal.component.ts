import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges, HostListener } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import {
  BankService, BankMovement, BankStatus, ErpCxC, ErpLink, DesgloseFormaPago, CfdiBusquedaResult,
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
  // Bug real 2026-07-31: confirmErp() se tragaba cualquier error de setErpIds en silencio
  // (solo apagaba erpSaving/cobroActivado) — un cobranza sin banks:erp:link veía el cobro
  // aplicarse en Kore y el modal simplemente no confirmaba nada, sin ningún aviso de qué
  // pasó. Ahora el error queda visible acá.
  confirmErpError: string | null = null;
  erpPage                 = 1;
  erpTotalPaginas         = 1;
  erpTotalRegistros       = 0;
  private erpCxcCache     = new Map<string, ErpCxC>();
  erpSoloPendientes       = true;
  // 2026-08-05: solo lista — el ERP mezcla ventas normales dentro de origen=anticipo,
  // por eso el backend además filtra por esAnticipo===true (ver erp.routes.js). Qué hacer
  // al seleccionar/cobrar un anticipo queda pendiente, fuera de alcance por ahora.
  erpSoloAnticipos        = false;
  erpIdsOriginal: string[] = [];  // public: read by parent via @ViewChild for cobro flow

  // 2026-08-05: reportado por el usuario — Kore devuelve 0 resultados si se manda
  // origen=anticipo JUNTO con estadoCobro=pendiente (un anticipo trae saldoActual
  // negativo, no cuadra con el criterio de "pendiente" de Kore). Se excluyen mutuamente
  // acá, no en el template, para que también aplique a roles que no ven el checkbox
  // "Solo pendientes" (oculto salvo admin) — igual quedan con erpSoloPendientes:true por
  // default, así que sin este ajuste nunca podrían ver anticipos.
  onToggleSoloPendientes(value: boolean): void {
    this.erpSoloPendientes = value;
    if (value) this.erpSoloAnticipos = false;
  }

  onToggleSoloAnticipos(): void {
    this.erpSoloAnticipos = !this.erpSoloAnticipos;
    // Mutuamente excluyentes (ver comentario 2026-08-05 arriba). Pedido 2026-08-13: al
    // desmarcar Anticipos, "Solo pendientes" vuelve a su default (true) en vez de quedar
    // apagado — sin esto, un usuario que probó Anticipos y volvió atrás se quedaba viendo
    // TODAS las CxC (pendientes + liquidadas) sin haberlo pedido.
    this.erpSoloPendientes = !this.erpSoloAnticipos;
    // A diferencia de "Solo pendientes" (requiere click en "Buscar"), este switch
    // dispara la búsqueda de inmediato — pedido explícito del usuario 2026-08-05.
    this.loadErpCuentas(1);
  }

  // CxC ya vinculadas (erpIdsOriginal) que el usuario marcó explícitamente para cobrar
  // OTRA vez en esta sesión — ver toggleCxC()/isCxCSelectedForCobro(). Nunca se tocan
  // solas: marcar/desmarcar una CxC ya vinculada no la desvincula (para eso existe el
  // botón "✕ Desvincular" de los chips de arriba, banks:erp:unlink).
  // Público: leído por cobro-panel vía @ViewChild para decidir qué CxC entran al cobro.
  cobroSeleccionIds = new Set<string>();

  fichaInput               = '';
  savingFicha              = false;
  deletingFicha            = false;
  fichaError: string | null = null;

  // Búsqueda de CFDIs (colección cfdis, solo source='ERP') por serie-folio — 2026-08-07,
  // permiso propio banks:cfdi:read. Mismo formato de entrada "SERIE-FOLIO" que el
  // buscador de CxC (parseErpSearch), pero contra Mongo directo, no contra Kore.
  cfdiSearchInput           = '';
  cfdiResultados: CfdiBusquedaResult[] = [];
  cfdiSearching             = false;
  cfdiSearchError: string | null = null;
  // Coordenadas viewport (position:fixed) del dropdown de resultados, hoisted fuera de
  // .erp-linked-bar/.modal-box (ambos recortarían un position:absolute anidado).
  cfdiResultsPos: { top: number; right: number } | null = null;
  // El click afuera no borra cfdiResultsPos (así no hay que recalcular el rect al
  // reabrir) — solo oculta el dropdown vía este flag. searchCfdis() lo vuelve a poner en
  // false al iniciar una búsqueda nueva, para que un resultado/error que llegue después
  // de que el usuario clickeó afuera SÍ se vuelva a mostrar (bug real encontrado en
  // revisión: sin esto, un error de red quedaba invisible si el usuario clickeaba
  // afuera mientras la búsqueda seguía en vuelo).
  cfdiDropdownDismissed = false;
  // Cancela la búsqueda anterior antes de iniciar una nueva Y al cambiar de movimiento/
  // cerrar el modal — bug real de revisión: este componente nunca se destruye entre
  // aperturas (banks.component.html usa [hidden], no *ngIf), así que takeUntil(destroy$)
  // por sí solo nunca corta una respuesta tardía de OTRO movimiento distinto.
  private cfdiSearchSub: Subscription | null = null;
  // Segunda parte (2026-08-07): vincular la CxC real de Kore detrás de un match de CFDI.
  // cfdiLinkingId marca qué fila del dropdown está resolviéndose (uuid del CFDI) — solo
  // puede haber una a la vez, mismo criterio de cancelación explícita que cfdiSearchSub.
  cfdiLinkingId: string | null = null;
  private cfdiLinkSub: Subscription | null = null;

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
  readonly cfdiSearch$  = new Subject<string>();

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

    this.cfdiSearch$.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.searchCfdis());
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
    this.cobroSeleccionIds = new Set<string>();
    this.erpSearch         = '';
    this.erpSaving         = false;
    this.confirmErpError   = null;
    this.erpPage           = 1;
    this.erpTotalPaginas   = 1;
    this.erpCxcCache.clear();
    this.fichaInput        = '';
    this.savingFicha       = false;
    this.deletingFicha     = false;
    this.fichaError        = null;
    this.cfdiSearchSub?.unsubscribe();
    this.cfdiSearchSub     = null;
    this.cfdiSearchInput   = '';
    this.cfdiResultados    = [];
    this.cfdiSearching     = false;
    this.cfdiSearchError   = null;
    this.cfdiResultsPos    = null;
    this.cfdiDropdownDismissed = false;
    this.cfdiLinkSub?.unsubscribe();
    this.cfdiLinkSub       = null;
    this.cfdiLinkingId     = null;
    this.showErpCloseConfirm = false;
    this._clienteMarcarTodosOverride = null;
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
    this.cfdiSearchSub?.unsubscribe();
    this.cfdiSearchSub       = null;
    this.cfdiSearchInput     = '';
    this.cfdiResultados      = [];
    this.cfdiResultsPos      = null;
    this.cfdiDropdownDismissed = false;
    this.cfdiLinkSub?.unsubscribe();
    this.cfdiLinkSub         = null;
    this.cfdiLinkingId       = null;
    this.showErpCloseConfirm = false;
    this.closed.emit();
  }

  getCxcFromCache(id: string): ErpCxC | undefined { return this.erpCxcCache.get(id); }

  // Public: parent calls this (via @ViewChild) before confirmErp() in cobro success flow
  activateCobro(): void { this.cobroActivado = true; }

  private _cobroSaldosErp: {
    saldosActual: Record<string, number>;
    saldosPagado: Record<string, number>;
    saldosPagadoTotal: Record<string, number>;
    desglosePorFormaPago: Record<string, DesgloseFormaPago[]>;
  } | null = null;

  // Recibe el saldo restante (saldosActual), el monto acumulado bancario (saldosPagado —
  // transferencia/depósito en efectivo/cheque, alimenta el badge de la tabla), el monto
  // acumulado por TODAS las formas de pago (saldosPagadoTotal — alimenta saldoErp) y la
  // bitácora de auditoría por forma de pago (desglosePorFormaPago) por CxC, calculados en
  // el cobro panel. confirmErp() lo consume una sola vez para actualizar cada erpLink.
  setCobroSaldosErp(saldos: {
    saldosActual: Record<string, number>;
    saldosPagado: Record<string, number>;
    saldosPagadoTotal: Record<string, number>;
    desglosePorFormaPago: Record<string, DesgloseFormaPago[]>;
  }): void {
    this._cobroSaldosErp = saldos;
  }

  // Public: parent calls this (via @ViewChild) from cobro panel's apply-success handler
  confirmErp(): void {
    if (!this.movement || this.erpSaving) return;
    this.erpSaving      = true;
    this.confirmErpError = null;
    const mov = this.movement;
    const ids  = [...(mov.erpIds ?? [])];

    const cobroSaldos = this._cobroSaldosErp;
    this._cobroSaldosErp = null;

    const erpLinks: ErpLink[] = ids.map(erpId => {
      const overrideActual      = cobroSaldos?.saldosActual?.[erpId];
      const overridePagado      = cobroSaldos?.saldosPagado?.[erpId];
      const overridePagadoTotal = cobroSaldos?.saldosPagadoTotal?.[erpId];
      const overrideDesglose    = cobroSaldos?.desglosePorFormaPago?.[erpId];
      const cached = this.erpCxcCache.get(erpId);
      if (cached) {
        return {
          erpId,
          saldoActual:      overrideActual      !== undefined ? overrideActual      : cached.saldoActual,
          saldoPagado:      overridePagado      !== undefined ? overridePagado      : null,
          saldoPagadoTotal: overridePagadoTotal !== undefined ? overridePagadoTotal : null,
          folioFiscal:  cached.folioFiscal ?? null,
          total:        cached.total,
          serie:        cached.serie ?? null,
          folioExterno: cached.folioExterno ?? null,
          tipoPago:     cached.tipoPago ?? null,
          desglosePorFormaPago: overrideDesglose ?? [],
          origen:       cached.origen ?? null,
        };
      }
      const inPage = this.erpCxcList.find(c => c.id === erpId);
      if (inPage) {
        return {
          erpId,
          saldoActual:      overrideActual      !== undefined ? overrideActual      : inPage.saldoActual,
          saldoPagado:      overridePagado      !== undefined ? overridePagado      : null,
          saldoPagadoTotal: overridePagadoTotal !== undefined ? overridePagadoTotal : null,
          folioFiscal:  inPage.folioFiscal ?? null,
          total:        inPage.total,
          serie:        inPage.serie ?? null,
          folioExterno: inPage.folioExterno ?? null,
          tipoPago:     inPage.tipoPago ?? null,
          desglosePorFormaPago: overrideDesglose ?? [],
          origen:       inPage.origen ?? null,
        };
      }
      const prev = (mov.erpLinks ?? []).find((l: ErpLink) => l.erpId === erpId);
      if (prev) {
        if (overrideActual !== undefined || overridePagado !== undefined || overridePagadoTotal !== undefined) {
          return {
            ...prev,
            ...(overrideActual      !== undefined && { saldoActual: overrideActual }),
            ...(overridePagado      !== undefined && { saldoPagado: overridePagado }),
            ...(overridePagadoTotal !== undefined && { saldoPagadoTotal: overridePagadoTotal }),
            ...(overrideDesglose    !== undefined && { desglosePorFormaPago: overrideDesglose }),
          };
        }
        return prev;
      }

      console.warn(`[confirmErp] erpId ${erpId} no encontrado en cache, lista ni links previos`);
      return {
        erpId, saldoActual: overrideActual ?? 0, saldoPagado: overridePagado ?? null,
        saldoPagadoTotal: overridePagadoTotal ?? null, folioFiscal: null, total: 0,
      };
    });

    this.bankService.setErpIds(mov._id, erpLinks)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          mov.erpIds          = res.erpIds;
          mov.erpLinks        = res.erpLinks;
          mov.historialVinculacion = res.historialVinculacion;
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
        error: (err) => {
          this.erpSaving        = false;
          this.cobroActivado    = false;
          this.confirmErpError  = err?.error?.error || 'No se pudo guardar la vinculación de la CxC con el movimiento.';
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

  // Búsqueda de CFDIs por serie-folio (colección cfdis, solo source='ERP') — mismo
  // formato de entrada que parseErpSearch. Implementación de la primera parte del
  // pedido (2026-08-07): input + búsqueda + resultados visibles; la acción al elegir
  // un resultado queda para una segunda parte todavía sin definir.
  onCfdiSearchInput(): void {
    this.cfdiDropdownDismissed = false;
    this.cfdiSearch$.next(this.cfdiSearchInput);
  }

  onCfdiInputFocus(event: Event): void {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    this.cfdiResultsPos        = { top: rect.bottom + 4, right: window.innerWidth - rect.right };
    this.cfdiDropdownDismissed = false;
  }

  // Oculta el dropdown de resultados de CFDI al clickear afuera (NO borra cfdiResultsPos,
  // solo el flag — ver comentario de cfdiDropdownDismissed más arriba). Mismo criterio que
  // onDocumentClick() de banks.component.ts para erpDetailPos/historialPos. El input y el
  // dropdown ya paran la propagación en su propio (click), así que cualquier click que
  // llegue hasta acá es "afuera" por definición. 2 disparadores necesarios: el
  // @HostListener cubre clicks en el backdrop (que sí burbujean hasta document); el
  // .modal-box también lo llama directo en su propio (click), porque ese mismo div ya
  // hace stopPropagation() — sin eso, ningún click DENTRO del modal llegaría nunca a
  // document, y el dropdown jamás se cerraría al clickear otra parte del modal.
  @HostListener('document:click')
  closeCfdiDropdown(): void {
    this.cfdiDropdownDismissed = true;
  }

  searchCfdis(): void {
    // Cancela cualquier búsqueda anterior en vuelo ANTES de empezar una nueva — bug real de
    // revisión: sin esto, una respuesta tardía de un término de búsqueda viejo (o de un
    // movimiento distinto, ver cfdiSearchSub) podía sobrescribir resultados más nuevos.
    this.cfdiSearchSub?.unsubscribe();
    this.cfdiSearchSub = null;

    const { serieExterna, folioExterno } = this.parseErpSearch(this.cfdiSearchInput);
    if (!serieExterna && !folioExterno) {
      this.cfdiResultados  = [];
      this.cfdiSearchError = null;
      return;
    }
    this.cfdiSearching   = true;
    this.cfdiSearchError = null;
    this.cfdiSearchSub = this.bankService.buscarCfdis(serieExterna, folioExterno)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (resultados) => {
          this.cfdiResultados = resultados;
          this.cfdiSearching  = false;
        },
        error: () => {
          this.cfdiResultados  = [];
          this.cfdiSearching   = false;
          this.cfdiSearchError = 'No se pudo buscar el CFDI';
        },
      });
  }

  // Segunda parte del buscador de CFDI (2026-08-07): al elegir un match, resuelve la CxC
  // real de Kore por serie-folio (nunca usa el `total` del CFDI para el link — puede haber
  // pagos parciales que el CFDI no refleja) y la vincula con el MISMO mecanismo que ya usa
  // el listado normal (toggleCxC) — mismo comportamiento: queda en movement.erpIds,
  // aplicarLogicaErp() en el backend recalcula saldoErp/status/diferencia al guardar, y
  // sigue requiriendo el click en "Guardar" (banks:erp:link), no se auto-persiste.
  linkCfdiResult(cfdi: CfdiBusquedaResult): void {
    if (this.cfdiLinkingId || !cfdi.serie || !cfdi.folio) return;

    this.cfdiLinkSub?.unsubscribe();
    this.cfdiLinkingId   = cfdi.uuid;
    this.cfdiSearchError = null;
    this.cfdiLinkSub = this.bankService.resolverCuentaPorSerieFolio(cfdi.serie, cfdi.folio)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (cxc) => {
          this.cfdiLinkingId = null;
          // Bug real de revisión: toggleCxC() es un TOGGLE — si esta CxC ya estaba
          // vinculada (ej. el usuario repite la misma búsqueda), llamarlo de nuevo la
          // DESVINCULA en silencio, sin ningún aviso. El dropdown normal de checkboxes
          // muestra el estado marcado/desmarcado antes de clickear; este no, así que hay
          // que chequearlo a mano en vez de confiar en el toggle ciego.
          if ((this.movement?.erpIds ?? []).includes(cxc.id)) {
            this.cfdiSearchError = 'Esta CxC ya está vinculada a este depósito.';
            return;
          }
          this.toggleCxC(cxc.id, cxc);
          this.cfdiSearchInput       = '';
          this.cfdiResultados        = [];
          this.cfdiDropdownDismissed = true;
        },
        error: (err: { error?: { error?: string } }) => {
          this.cfdiLinkingId   = null;
          this.cfdiSearchError = err?.error?.error || 'No se pudo vincular esta CxC en Kore';
        },
      });
  }

  loadErpCuentas(page = 1): void {
    // Hueco de seguridad cerrado 2026-08-07: sin banks:erp:read no se debe ni intentar
    // la consulta (el backend la rechaza con 403 de todos modos, pero evita el request
    // fallido en cada apertura del modal para roles sin este permiso).
    if (!this.auth.hasPermission('banks:erp:read')) return;
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
      this.erpSoloAnticipos,
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

  // Navegación rápida de mes sin abrir el select — igual que erpPrevPage/erpNextPage,
  // recarga de inmediato. No cruza los límites de erpAnios (rango de años disponible).
  erpMesAnterior(): void {
    if (this.erpMes === 1) {
      if (!this.erpAnios.includes(this.erpAnio - 1)) return;
      this.erpMes  = 12;
      this.erpAnio -= 1;
    } else {
      this.erpMes -= 1;
    }
    this.loadErpCuentas(1);
  }

  erpMesSiguiente(): void {
    if (this.erpMes === 12) {
      if (!this.erpAnios.includes(this.erpAnio + 1)) return;
      this.erpMes  = 1;
      this.erpAnio += 1;
    } else {
      this.erpMes += 1;
    }
    this.loadErpCuentas(1);
  }

  // Historial: ¿esta CxC está vinculada a este movimiento (ahora o de antes)? No cambia
  // con el checkbox de la lista — solo lo cambia vincular una CxC nueva o desvincular
  // (chip "✕" de arriba). Gobierna el tinte verde de la fila, no el checkbox.
  isCxCLinked(id: string): boolean {
    return (this.movement?.erpIds ?? []).includes(id);
  }

  // ¿Esta CxC está marcada para un cobro EN ESTA SESIÓN? Para una CxC nueva (no estaba
  // vinculada al abrir el modal) coincide con isCxCLinked — marcarla la agrega como
  // vínculo nuevo. Para una CxC ya vinculada de antes, es independiente: arranca sin
  // marcar (aunque isCxCLinked sea true) y el usuario decide si la vuelve a cobrar.
  isCxCSelectedForCobro(id: string): boolean {
    if (this.erpIdsOriginal.includes(id)) return this.cobroSeleccionIds.has(id);
    return (this.movement?.erpIds ?? []).includes(id);
  }

  // Origen de una CxC vinculada: primero la sesión actual (erpCxcCache, antes de guardar),
  // si no está ahí cae a lo ya persistido de una sesión anterior (movement.erpLinks) —
  // mismo patrón de fallback que erpLinkLabel().
  private _origenDeCxC(id: string): string | null {
    const cached = this.erpCxcCache.get(id)?.origen;
    if (cached) return cached;
    return (this.movement?.erpLinks ?? []).find((l: ErpLink) => l.erpId === id)?.origen ?? null;
  }

  // Pedido 2026-08-13: un anticipo nunca es cobrable desde "Aplicar Cobro" — Guardar es
  // el único camino para persistirlo. Solo se puede leer desde erpCxcCache (esta sesión):
  // ErpLink (lo que sobrevive a reabrir el modal) todavía no persiste esAnticipo, a
  // diferencia de origen (ver BankMovement.model.js:81) — por eso una CxC-anticipo ya
  // vinculada en una sesión anterior no queda cubierta por este chequeo todavía.
  private _esAnticipoDeCxC(id: string): boolean {
    return this.erpCxcCache.get(id)?.esAnticipo === true;
  }

  // CxC elegibles para un cobro ahora: nuevas de esta sesión, o ya vinculadas de antes
  // pero marcadas explícitamente para otra parcialidad. Fuente única para el botón
  // "Aplicar cobro" de abajo y para cobro-panel._cobroIds() (leído vía @ViewChild) —
  // así las dos partes de la pantalla nunca pueden desacordar en qué CxC se está cobrando.
  // Pedido 2026-08-10: las CxC de origen 'cfdi_liquidado' (vinculadas vía el buscador de
  // CFDI, sin verificación en vivo contra Kore) nunca son cobrables — se excluyen acá para
  // que la regla se propague sola a todo el flujo de cobro sin duplicar el filtro.
  get cobroIds(): string[] {
    const all = this.movement?.erpIds ?? [];
    const elegibles = this.erpIdsOriginal.length === 0
      ? all
      : all.filter(id => !this.erpIdsOriginal.includes(id) || this.cobroSeleccionIds.has(id));
    return elegibles.filter(id => this._origenDeCxC(id) !== 'cfdi_liquidado' && !this._esAnticipoDeCxC(id));
  }

  // Aplicar Cobro y Guardar son mutuamente excluyentes (pedido 2026-08-10): si el cobro
  // está disponible, su propio flujo ya persiste el vínculo al terminar (ver confirmErp(),
  // llamado por el panel de cobro tras aplicar con éxito) — mostrar Guardar además sería un
  // botón redundante. Cuando NO hay nada cobrable (ej. todo lo pendiente es de origen CFDI,
  // o el usuario no tiene banks:cobro), Guardar es el único camino para persistir.
  //
  // Excepción para admin (pedido 2026-08-25): admin puede necesitar vincular una CxC para
  // revisión/corrección SIN disparar el efecto real de aplicar el cobro contra Kore — a
  // diferencia de cobranza (para quien la exclusión sigue igual, ese rol siempre tiene que
  // terminar el flujo por Aplicar Cobro). Para admin, Guardar queda disponible ADEMÁS de
  // Aplicar Cobro cuando ambos aplican — no lo reemplaza, es una opción extra.
  get canAplicarCobro(): boolean {
    return this.auth.hasPermission('banks:cobro') && this.cobroIds.length > 0;
  }

  // 2026-09-02 (bug real reportado por el usuario): antes exigía erpIds.length > 0 a secas,
  // así que sacar el ÚLTIMO vínculo (ej. desvincular una transferencia entre cajas para dejar
  // el movimiento como no identificado) hacía desaparecer este botón del DOM — sin él no había
  // forma de persistir esa desvinculación. Ahora también se habilita cuando hasUnsavedCxC es
  // true con erpIds vacío: hubo un cambio real (algo se sacó) que sigue siendo necesario
  // guardar, aunque el resultado final sea "sin nada vinculado".
  get canGuardar(): boolean {
    return this.auth.hasPermission('banks:erp:link')
      && ((this.movement?.erpIds ?? []).length > 0 || this.hasUnsavedCxC)
      && (!this.canAplicarCobro || this.auth.hasRole('admin'));
  }

  // `cxcData` opcional: permite vincular una CxC que NO viene del listado paginado
  // normal (`erpCxcList`) — usado por linkCfdiResult(), que la resuelve contra Kore por
  // serie-folio a partir de un match del buscador de CFDI. Sin este parámetro, el
  // comportamiento es idéntico al de siempre (busca en erpCxcList).
  toggleCxC(id: string, cxcData?: ErpCxC): void {
    if (!this.movement) return;

    // CxC ya vinculada de una sesión anterior: el checkbox NUNCA la desvincula, solo
    // decide si se incluye en un cobro nuevo ahora (ver cobro-panel._cobroIds()).
    // Desvincularla de verdad es la acción aparte y explícita de los chips de arriba.
    if (this.erpIdsOriginal.includes(id)) {
      if (this.cobroSeleccionIds.has(id)) this.cobroSeleccionIds.delete(id);
      else this.cobroSeleccionIds.add(id);
      return;
    }

    const ids = this.movement.erpIds ?? [];
    if (ids.includes(id)) {
      this.movement.erpIds = ids.filter(x => x !== id);
      this.erpCxcCache.delete(id);
    } else {
      this.movement.erpIds = [...ids, id];
      const cxc = cxcData ?? this.erpCxcList.find(c => c.id === id);
      if (cxc) {
        this.erpCxcCache.set(id, cxc);
        // El usuario decidió marcar esta CxC a mano — su cliente pasa a ser la
        // referencia de "Marcar todos", aunque no sea la CxC más reciente del listado.
        this._clienteMarcarTodosOverride = cxc;
      }
    }
  }

  // "Marcar todos" no marca literalmente todo lo visible: toma como referencia la CxC
  // más reciente del listado (o la que el usuario haya marcado a mano más recientemente,
  // ver _clienteMarcarTodosOverride) y solo marca las CxC de ESE cliente — así una
  // búsqueda con resultados mezclados (ej. por folio) no marca cuentas de otra persona.
  private _clienteMarcarTodosOverride: ErpCxC | null = null;

  private _folioOrdenable(cxc: ErpCxC): number {
    const digitos = String(cxc.folioExterno ?? '').replace(/\D/g, '');
    return digitos ? parseInt(digitos, 10) : -Infinity;
  }

  private _mismoCliente(a: ErpCxC, ref: ErpCxC): boolean {
    if (ref.personaId) return a.personaId === ref.personaId;
    return !!a.nombrePersona && this._norm(a.nombrePersona) === this._norm(ref.nombrePersona ?? '');
  }

  private _norm(s: string): string {
    return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  // CxC de referencia: la que el usuario marcó a mano más recientemente (si su cliente
  // sigue presente en el listado actual), si no, la más reciente del listado (mayor folioExterno).
  get clienteMarcarTodosRef(): ErpCxC | null {
    const override = this._clienteMarcarTodosOverride;
    if (override && this.filteredCxC.some(c => this._mismoCliente(c, override))) {
      return override;
    }
    if (!this.filteredCxC.length) return null;
    return this.filteredCxC.reduce((mas, actual) =>
      this._folioOrdenable(actual) > this._folioOrdenable(mas) ? actual : mas);
  }

  // Subconjunto del listado que pertenece al mismo cliente que la CxC más reciente.
  get cxcMarcarTodos(): ErpCxC[] {
    const ref = this.clienteMarcarTodosRef;
    if (!ref) return [];
    return this.filteredCxC.filter(c => this._mismoCliente(c, ref));
  }

  get allFilteredLinked(): boolean {
    const subset = this.cxcMarcarTodos;
    return subset.length > 0 && subset.every(c => this.isCxCSelectedForCobro(c.id));
  }

  toggleMarcarTodos(): void {
    if (!this.movement) return;
    const subset = this.cxcMarcarTodos;
    if (!subset.length) return;
    const marcarTodos = !this.allFilteredLinked;
    const ids = new Set(this.movement.erpIds ?? []);
    for (const cxc of subset) {
      // Ya vinculada de antes: el bulk-toggle tampoco la desvincula, solo mueve su
      // selección de cobro — mismo criterio que toggleCxC() para una sola CxC.
      if (this.erpIdsOriginal.includes(cxc.id)) {
        if (marcarTodos) this.cobroSeleccionIds.add(cxc.id);
        else this.cobroSeleccionIds.delete(cxc.id);
        continue;
      }
      if (marcarTodos) {
        ids.add(cxc.id);
        this.erpCxcCache.set(cxc.id, cxc);
      } else {
        ids.delete(cxc.id);
        this.erpCxcCache.delete(cxc.id);
      }
    }
    this.movement.erpIds = [...ids];
  }

  unlinkCxC(id: string, event: Event): void {
    event.stopPropagation();
    if (!this.movement) return;
    this.movement.erpIds = (this.movement.erpIds ?? []).filter(x => x !== id);
    this.erpCxcCache.delete(id);
  }

  // Un erpId de transferencia entre cajas (erpLink sintético CAJA-<koreId>, ver
  // caja-transferencia-confirm.service.js) no es una CxC real de Kore — separado de
  // erpIdsReales() para no mostrarlo bajo el label "CxC:" (mismo criterio que
  // banks.component.ts#esTransferenciaCaja, aplicado acá por eid individual porque el
  // modal itera erpIds uno por uno en vez de recibir el BankMovement completo cada vez).
  esErpIdTransferenciaCaja(eid: string): boolean {
    return (this.movement?.erpLinks ?? []).some((l: ErpLink) => l.erpId === eid && l.origen === 'transferencia-caja');
  }

  erpIdsReales(): string[] {
    return (this.movement?.erpIds ?? []).filter(eid => !this.esErpIdTransferenciaCaja(eid));
  }

  erpIdsTransferenciaCaja(): string[] {
    return (this.movement?.erpIds ?? []).filter(eid => this.esErpIdTransferenciaCaja(eid));
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
