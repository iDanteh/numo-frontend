import { Component, OnInit, OnDestroy, HostListener, Output, EventEmitter } from '@angular/core';
import * as XLSX from 'xlsx';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  BankService,
  RefacturacionesCycResult, NoMatcheadoCyc, RazonNoMatchCyc,
  MostradorCycResult, NoMatcheadoMostrador, RazonNoMatchMostrador,
  PagosCycResult, NoMatcheadoPagos, RazonNoMatchPagos,
  SaldoSyncJobSummary,
} from '../../../../core/services/bank.service';
import {
  SocketService,
  ErpSaldoSyncDoneEvent,
  ErpSaldoSyncStoppedEvent,
} from '../../../../core/services/socket.service';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  standalone: false,
  selector: 'app-admin-ops-panel',
  templateUrl: './admin-ops-panel.component.html',
  styleUrls: ['./admin-ops-panel.component.css'],
})
export class AdminOpsPanelComponent implements OnInit, OnDestroy {
  @Output() refreshCards    = new EventEmitter<void>();
  @Output() refreshMovements = new EventEmitter<void>();
  @Output() openDuplicates  = new EventEmitter<void>();

  private destroy$ = new Subject<void>();

  adminDropdownOpen = false;

  // ── Match ERP ─────────────────────────────────────────────────────────────
  matchingErp        = false;
  revertingErp       = false;
  matchErpJobId:     string | null = null;
  matchErpPhase:     string | null = null;
  matchErpPct        = 0;
  matchErpResult: {
    total: number; matcheados: number; identificados: number; sinMatch: number;
    noMatcheados: {
      autorizacion:  string;
      importe:       number;
      banco:         string | null;
      erpId:         string | null;
      folioExterno:  string | null;
      serie:         string | null;
      folioFiscal:   string | null;
      fechaRealPago: string | null;
    }[];
  } | null = null;
  revertErpResult:   { reverted: number; message: string } | null = null;
  matchErpError:     string | null = null;
  showErpNoMatcheados = false;
  private _matchErpTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly MATCH_ERP_TIMEOUT_MS = 5 * 60 * 1000;

  // ── Match autorizaciones ──────────────────────────────────────────────────
  matchingAuts = false;
  matchAutsResult: {
    total: number; matcheados: number; identificados: number;
    yaIdentificados: number; sinMatch: number;
    noMatcheados:   { autorizacion: string; importe: number; banco: string | null }[];
    matcheadosList: { autorizacion: string; importe: number | null; banco: string | null; estado: string }[];
  } | null = null;
  showNoMatcheados = false;
  matchAutsError:  string | null = null;

  // ── Refacturaciones CYC ───────────────────────────────────────────────────
  procesandoCyc       = false;
  cycResult: RefacturacionesCycResult | null = null;
  cycError: string | null = null;
  showNoMatcheadosCyc = false;
  cycFiltroRazon: RazonNoMatchCyc | 'todos' = 'todos';

  get cycNoMatcheadosFiltrados(): NoMatcheadoCyc[] {
    if (!this.cycResult) return [];
    const items = this.cycResult.detalleNoMatcheados;
    if (this.cycFiltroRazon === 'todos') return items;
    return items.filter(i => i.razon === this.cycFiltroRazon);
  }

  // ── Mostrador CYC ─────────────────────────────────────────────────────────
  procesandoMostrador      = false;
  mostradorResult: MostradorCycResult | null = null;
  mostradorError: string | null = null;
  showDetailsMostrador     = false;
  mostradorTab: 'relacionados' | 'no_matcheados' | 'ignorados' = 'relacionados';
  mostradorFiltroRazon: RazonNoMatchMostrador | 'todos' = 'todos';
  exportingMostrador       = false;

  get mostradorNoMatchFiltrados(): NoMatcheadoMostrador[] {
    if (!this.mostradorResult) return [];
    const items = this.mostradorResult.detalleNoMatcheados;
    if (this.mostradorFiltroRazon === 'todos') return items;
    return items.filter(i => i.razon === this.mostradorFiltroRazon);
  }

  // ── Pagos CYC ─────────────────────────────────────────────────────────────
  procesandoPagos          = false;
  pagosResult: PagosCycResult | null = null;
  pagosError: string | null = null;
  showDetailsPagos         = false;
  pagosTab: 'relacionados' | 'no_matcheados' | 'ignorados' = 'relacionados';
  pagosFiltroRazon: RazonNoMatchPagos | 'todos' = 'todos';
  exportingPagos           = false;

  get pagosNoMatchFiltrados(): NoMatcheadoPagos[] {
    if (!this.pagosResult) return [];
    const items = this.pagosResult.detalleNoMatcheados;
    if (this.pagosFiltroRazon === 'todos') return items;
    return items.filter(i => i.razon === this.pagosFiltroRazon);
  }

  // ── Identificar anteriores ─────────────────────────────────────────────────
  identificandoAnteriores  = false;
  revirtandoAnteriores     = false;
  identificarAntResult: { marcados: number; message: string } | null = null;
  revertirAntResult: { revertidos: number; message: string } | null  = null;
  anteriorError: string | null = null;

  // ── Sync Saldo Transferencia ──────────────────────────────────────────────
  saldoSyncStatus:  'idle' | 'running' | 'paused' | 'stopped' = 'idle';
  saldoSyncJobId:   string | null = null;
  saldoSyncPct      = 0;
  saldoSyncMsg:     string | null = null;
  saldoSyncResult:  ErpSaldoSyncDoneEvent | null = null;
  saldoSyncStopped: ErpSaldoSyncStoppedEvent | null = null;
  saldoSyncError:   string | null = null;
  revertSaldoSyncResult: { revertidos: number; omitidosPorCorridaMasReciente: number } | null = null;

  // Rescate para corridas viejas donde ya no aplica "Revertir esta corrida" (jobId expirado
  // o el movimiento quedó 'sinTransferencia'/'error' y nunca tuvo entrada en _changelog).
  showResetCheckpointModal  = false;
  reiniciandoCheckpoint     = false;
  resetCheckpointResult: { reiniciados: number } | null = null;
  resetCheckpointError:  string | null = null;

  // jobId actualmente en vuelo para descarga/revert — sirve tanto para el panel principal
  // como para las filas del historial (permite tener varias corridas visibles a la vez).
  descargandoReporteJobId: string | null = null;
  revirtiendoJobId:        string | null = null;

  // Rango de fechas ajustable manualmente (yyyy-mm-dd, para <input type="date">).
  // Se precarga con los defaults del backend y el admin puede cambiarlo antes de correr.
  saldoSyncFechaDesde: string | null = null;
  saldoSyncFechaHasta: string | null = null;

  // Historial de corridas recientes — permite descargar/revertir una corrida que no sea la última.
  mostrarHistorialSaldo  = false;
  cargandoHistorialSaldo = false;
  saldoSyncHistory: SaldoSyncJobSummary[] = [];

  /** true cuando hay un job activo (corriendo o en pausa) — usado por la template existente */
  get saldoSyncRunning(): boolean {
    return this.saldoSyncStatus === 'running' || this.saldoSyncStatus === 'paused';
  }

  // ── Importar conciliación ──────────────────────────────────────────────────
  importandoConciliacion   = false;
  revirtandoConciliacion   = false;
  showFallidosConciliacion = false;
  importConciliacionResult: {
    runId:           string;
    total:           number;
    identificados:   number;
    fallidos:        number;
    fallidosDetalle: { fecha: string; banco: string; monto: number }[];
  } | null = null;
  revertConciliacionResult: { revertidos: number; message: string } | null = null;
  importConciliacionError:  string | null = null;

  constructor(
    private bankService: BankService,
    private socketService: SocketService,
    readonly auth: AuthService,
  ) {}

  ngOnInit(): void {
    // Precargar el rango de fechas del Sync Saldo ERP con los defaults del backend
    this.bankService.getSaldoSyncDefaults().pipe(takeUntil(this.destroy$)).subscribe(d => {
      this.saldoSyncFechaDesde = d.fechaDesde.slice(0, 10);
      this.saldoSyncFechaHasta = d.fechaHasta.slice(0, 10);
    });

    // Recover pending ERP job from a previous session (page reload mid-job)
    const savedJobId = sessionStorage.getItem('erpMatchJobId');
    if (savedJobId) {
      this.matchErpJobId = savedJobId;
      this.matchingErp   = true;
      this.matchErpPhase = 'Recuperando estado del motor ERP…';
      this.bankService.getMatchErpJob(savedJobId).pipe(takeUntil(this.destroy$)).subscribe({
        next: (job) => {
          if (job.status === 'done') {
            this.matchErpResult  = job.result as typeof this.matchErpResult;
            this.matchingErp     = false;
            this.matchErpPhase   = null;
            this.matchErpJobId   = null;
            sessionStorage.removeItem('erpMatchJobId');
            if ((job.result as any)?.identificados > 0) this.refreshCards.emit();
          } else if (job.status === 'error') {
            this.matchErpError = (job as any).error || 'Error al procesar el motor ERP';
            this.matchingErp   = false;
            this.matchErpPhase = null;
            this.matchErpJobId = null;
            sessionStorage.removeItem('erpMatchJobId');
          }
          // status === 'running': socket will deliver done/error when ready
        },
        error: () => {
          sessionStorage.removeItem('erpMatchJobId');
          this.matchingErp   = false;
          this.matchErpPhase = null;
          this.matchErpJobId = null;
        },
      });
    }

    this.socketService.erpMatchProgress$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.jobId !== this.matchErpJobId) return;
      this.matchErpPhase = ev.msg;
      this.matchErpPct   = ev.pct;
    });

    this.socketService.erpMatchDone$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.jobId === this.matchErpJobId) {
        this.clearMatchErpTimeout();
        this.matchErpResult  = ev;
        this.matchingErp     = false;
        this.matchErpPhase   = null;
        this.matchErpJobId   = null;
        sessionStorage.removeItem('erpMatchJobId');
        if (ev.identificados > 0) this.refreshCards.emit();
      } else {
        // Another user's job finished — refresh silently
        this.refreshCards.emit();
        this.refreshMovements.emit();
      }
    });

    this.socketService.erpMatchError$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.jobId !== this.matchErpJobId) return;
      this.clearMatchErpTimeout();
      this.matchErpError = ev.error;
      this.matchingErp   = false;
      this.matchErpPhase = null;
      this.matchErpJobId = null;
      sessionStorage.removeItem('erpMatchJobId');
    });

    // Recuperar el job de sync saldo ERP tras un reload de página (misma pestaña/sesión).
    const savedSaldoSyncJobId = sessionStorage.getItem('erpSaldoSyncJobId');
    if (savedSaldoSyncJobId) {
      this.saldoSyncJobId = savedSaldoSyncJobId;
      this.saldoSyncMsg   = 'Recuperando estado de la sincronización…';
      this.bankService.getSaldoSyncJob(savedSaldoSyncJobId).pipe(takeUntil(this.destroy$)).subscribe({
        next: (job) => {
          if (job.status === 'done' && job.result) {
            this.saldoSyncResult = { jobId: savedSaldoSyncJobId, ...job.result };
            this.saldoSyncStatus = 'idle';
            this.saldoSyncJobId  = null;
            this.saldoSyncMsg    = null;
            sessionStorage.removeItem('erpSaldoSyncJobId');
          } else if (job.status === 'stopped' && job.result) {
            this.saldoSyncStopped = { jobId: savedSaldoSyncJobId, procesados: 0, ...job.result };
            this.saldoSyncStatus  = 'stopped';
            this.saldoSyncJobId   = null;
            this.saldoSyncMsg     = null;
            sessionStorage.removeItem('erpSaldoSyncJobId');
          } else if (job.status === 'error') {
            this.saldoSyncError  = job.error || 'Error en sincronización de saldo ERP';
            this.saldoSyncStatus = 'idle';
            this.saldoSyncJobId  = null;
            this.saldoSyncMsg    = null;
            sessionStorage.removeItem('erpSaldoSyncJobId');
          } else {
            // running o paused: el socket entregará progreso/fin cuando corresponda
            this.saldoSyncStatus = job.status === 'paused' ? 'paused' : 'running';
            this.saldoSyncMsg    = job.status === 'paused' ? 'En pausa' : 'Sincronizando…';
          }
        },
        error: () => {
          sessionStorage.removeItem('erpSaldoSyncJobId');
          this.saldoSyncStatus = 'idle';
          this.saldoSyncJobId  = null;
          this.saldoSyncMsg    = null;
        },
      });
    }

    this.socketService.erpSaldoSyncProgress$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.jobId !== this.saldoSyncJobId) return;
      this.saldoSyncPct = ev.pct;
      this.saldoSyncMsg = `Procesando ${ev.procesados} de ${ev.total}…`;
    });

    this.socketService.erpSaldoSyncDone$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.jobId !== this.saldoSyncJobId) return;
      this.saldoSyncResult = ev;
      this.saldoSyncStatus = 'idle';
      this.saldoSyncJobId  = null;
      this.saldoSyncMsg    = null;
      sessionStorage.removeItem('erpSaldoSyncJobId');
    });

    this.socketService.erpSaldoSyncError$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.jobId !== this.saldoSyncJobId) return;
      this.saldoSyncError  = ev.error;
      this.saldoSyncStatus = 'idle';
      this.saldoSyncJobId  = null;
      this.saldoSyncMsg    = null;
      sessionStorage.removeItem('erpSaldoSyncJobId');
    });

    this.socketService.erpSaldoSyncPaused$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.jobId !== this.saldoSyncJobId) return;
      this.saldoSyncStatus = 'paused';
    });

    this.socketService.erpSaldoSyncResumed$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.jobId !== this.saldoSyncJobId) return;
      this.saldoSyncStatus = 'running';
    });

    this.socketService.erpSaldoSyncStopped$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.jobId !== this.saldoSyncJobId) return;
      this.saldoSyncStopped = ev;
      this.saldoSyncStatus  = 'stopped';
      this.saldoSyncJobId   = null;
      this.saldoSyncMsg     = null;
      sessionStorage.removeItem('erpSaldoSyncJobId');
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.clearMatchErpTimeout();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.adminDropdownOpen = false;
  }

  toggleDropdown(): void { this.adminDropdownOpen = !this.adminDropdownOpen; }

  // ── Match ERP ─────────────────────────────────────────────────────────────

  runMatchErp(): void {
    this.matchingErp         = true;
    this.matchErpResult      = null;
    this.revertErpResult     = null;
    this.matchErpError       = null;
    this.matchErpJobId       = null;
    this.matchErpPhase       = 'Iniciando motor ERP...';
    this.matchErpPct         = 0;
    this.showErpNoMatcheados = false;
    this.bankService.matchAutorizacionesErp().subscribe({
      next: ({ jobId }) => {
        this.matchErpJobId = jobId;
        sessionStorage.setItem('erpMatchJobId', jobId);
        this.startMatchErpTimeout();
        // Result arrives via socket (erpMatchDone$ / erpMatchError$)
      },
      error: (err) => {
        this.matchErpError = err?.error?.error || 'Error al iniciar el motor ERP';
        this.matchingErp   = false;
        this.matchErpPhase = null;
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
        if (res.reverted > 0) this.refreshCards.emit();
      },
      error: (err) => {
        this.matchErpError = err?.error?.error || 'Error al revertir asociaciones ERP';
        this.revertingErp  = false;
      },
    });
  }

  private clearMatchErpTimeout(): void {
    if (this._matchErpTimeoutTimer) {
      clearTimeout(this._matchErpTimeoutTimer);
      this._matchErpTimeoutTimer = null;
    }
  }

  private startMatchErpTimeout(): void {
    this.clearMatchErpTimeout();
    this._matchErpTimeoutTimer = setTimeout(() => {
      if (!this.matchingErp || !this.matchErpJobId) return;
      const jobId = this.matchErpJobId;
      this.matchErpPhase = 'Verificando estado del motor ERP…';
      this.bankService.getMatchErpJob(jobId).pipe(takeUntil(this.destroy$)).subscribe({
        next: (job) => {
          if (job.status === 'done') {
            this.matchErpResult = job.result as typeof this.matchErpResult;
            this.matchingErp    = false;
            this.matchErpPhase  = null;
            this.matchErpJobId  = null;
            sessionStorage.removeItem('erpMatchJobId');
            if ((job.result as any)?.identificados > 0) this.refreshCards.emit();
          } else if (job.status === 'error') {
            this.matchErpError = (job as any).error || 'Error en el motor ERP';
            this.matchingErp   = false;
            this.matchErpPhase = null;
            this.matchErpJobId = null;
            sessionStorage.removeItem('erpMatchJobId');
          } else {
            // Still running after 5 min — unblock UI but preserve jobId for reload recovery
            this.matchErpError = 'El motor ERP lleva más de 5 minutos sin respuesta. '
              + 'El proceso puede seguir corriendo en el servidor. '
              + 'Recarga la página para verificar el estado final.';
            this.matchingErp   = false;
            this.matchErpPhase = null;
          }
        },
        error: () => {
          this.matchErpError = 'No se pudo verificar el estado del motor ERP. '
            + 'Recarga la página para continuar.';
          this.matchingErp   = false;
          this.matchErpPhase = null;
          this.matchErpJobId = null;
          sessionStorage.removeItem('erpMatchJobId');
        },
      });
    }, this.MATCH_ERP_TIMEOUT_MS);
  }

  // ── Match autorizaciones ──────────────────────────────────────────────────

  onAutsFileSelected(event: Event): void {
    this.adminDropdownOpen = false;
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    input.value = '';
    this.runMatchAutorizaciones(file);
  }

  private runMatchAutorizaciones(file: File): void {
    this.matchingAuts     = true;
    this.matchAutsResult  = null;
    this.matchAutsError   = null;
    this.showNoMatcheados = false;
    this.bankService.matchAutorizaciones(file).subscribe({
      next: (res) => {
        this.matchAutsResult = res;
        this.matchingAuts    = false;
        this.refreshCards.emit();
      },
      error: (err) => {
        this.matchAutsError = err?.error?.error || 'Error al procesar el archivo';
        this.matchingAuts   = false;
      },
    });
  }

  exportAutsExcel(): void {
    const res = this.matchAutsResult;
    if (!res) return;
    const wb   = XLSX.utils.book_new();
    const wsId = XLSX.utils.json_to_sheet(
      res.matcheadosList.length
        ? res.matcheadosList.map(r => ({
            'Autorización': r.autorizacion,
            'Importe':      r.importe,
            'Banco':        r.banco ?? '',
            'Estado':       r.estado,
          }))
        : [{ Nota: 'Sin resultados' }],
    );
    const wsSin = XLSX.utils.json_to_sheet(
      res.noMatcheados.length
        ? res.noMatcheados.map(r => ({
            'Autorización': r.autorizacion,
            'Importe':      r.importe,
            'Banco':        r.banco ?? '',
          }))
        : [{ Nota: 'Sin resultados' }],
    );
    XLSX.utils.book_append_sheet(wb, wsId,  'Identificados');
    XLSX.utils.book_append_sheet(wb, wsSin, 'Sin match');
    XLSX.writeFile(wb, 'autorizaciones-resultado.xlsx');
  }

  // ── Refacturaciones CYC ───────────────────────────────────────────────────

  onCycFileSelected(event: Event): void {
    this.adminDropdownOpen = false;
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    input.value = '';
    this.runRefacturacionesCyc(file);
  }

  private runRefacturacionesCyc(file: File): void {
    this.procesandoCyc       = true;
    this.cycResult           = null;
    this.cycError            = null;
    this.showNoMatcheadosCyc = false;
    this.cycFiltroRazon      = 'todos';
    this.bankService.uploadRefacturacionesCyc(file).subscribe({
      next: (res) => {
        this.cycResult     = res;
        this.procesandoCyc = false;
        if (res.detalleNoMatcheados.length) this.showNoMatcheadosCyc = true;
        this.refreshCards.emit();
      },
      error: (err) => {
        this.cycError      = err?.error?.error || 'Error al procesar el archivo';
        this.procesandoCyc = false;
      },
    });
  }

  // ── Mostrador CYC ─────────────────────────────────────────────────────────

  onMostradorFileSelected(event: Event): void {
    this.adminDropdownOpen = false;
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    input.value = '';
    this.runMostradorCyc(file);
  }

  private runMostradorCyc(file: File): void {
    this.procesandoMostrador  = true;
    this.mostradorResult      = null;
    this.mostradorError       = null;
    this.showDetailsMostrador = false;
    this.mostradorTab         = 'relacionados';
    this.mostradorFiltroRazon = 'todos';
    this.bankService.uploadMostradorCyc(file).subscribe({
      next: (res) => {
        this.mostradorResult      = res;
        this.procesandoMostrador  = false;
        this.showDetailsMostrador = true;
        if (res.relacionados === 0 && res.detalleNoMatcheados.length > 0) {
          this.mostradorTab = 'no_matcheados';
        }
        if (res.relacionados > 0) this.refreshCards.emit();
      },
      error: (err) => {
        this.mostradorError      = err?.error?.error || 'Error al procesar el archivo';
        this.procesandoMostrador = false;
      },
    });
  }

  exportMostradorCyc(): void {
    if (!this.mostradorResult || this.exportingMostrador) return;
    this.exportingMostrador = true;
    this.bankService.exportMostradorCyc(this.mostradorResult).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href     = url;
        a.download = `mostrador-cyc-${date}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportingMostrador = false;
      },
      error: () => { this.exportingMostrador = false; },
    });
  }

  // ── Pagos CYC ─────────────────────────────────────────────────────────────

  onPagosFileSelected(event: Event): void {
    this.adminDropdownOpen = false;
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    input.value = '';
    this.runPagosCyc(file);
  }

  private runPagosCyc(file: File): void {
    this.procesandoPagos   = true;
    this.pagosResult       = null;
    this.pagosError        = null;
    this.showDetailsPagos  = false;
    this.pagosTab          = 'relacionados';
    this.pagosFiltroRazon  = 'todos';
    this.bankService.uploadPagosCyc(file).subscribe({
      next: (res) => {
        this.pagosResult      = res;
        this.procesandoPagos  = false;
        this.showDetailsPagos = true;
        if (res.relacionados === 0 && res.detalleNoMatcheados.length > 0) {
          this.pagosTab = 'no_matcheados';
        }
        if (res.relacionados > 0) this.refreshCards.emit();
      },
      error: (err) => {
        this.pagosError      = err?.error?.error || 'Error al procesar el archivo';
        this.procesandoPagos = false;
      },
    });
  }

  exportPagosCyc(): void {
    if (!this.pagosResult || this.exportingPagos) return;
    this.exportingPagos = true;
    this.bankService.exportPagosCyc(this.pagosResult).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href     = url;
        a.download = `pagos-cyc-${date}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportingPagos = false;
      },
      error: () => { this.exportingPagos = false; },
    });
  }

  // ── Identificar anteriores ─────────────────────────────────────────────────

  runIdentificarAnteriores(): void {
    this.identificandoAnteriores = true;
    this.identificarAntResult    = null;
    this.revertirAntResult       = null;
    this.anteriorError           = null;
    this.bankService.identificarAnterioresAMayo().subscribe({
      next: (res) => {
        this.identificarAntResult    = res;
        this.identificandoAnteriores = false;
        if (res.marcados > 0) this.refreshCards.emit();
      },
      error: (err) => {
        this.anteriorError           = err?.error?.error || 'Error al identificar movimientos anteriores';
        this.identificandoAnteriores = false;
      },
    });
  }

  runRevertirAnteriores(): void {
    this.revirtandoAnteriores = true;
    this.identificarAntResult = null;
    this.revertirAntResult    = null;
    this.anteriorError        = null;
    this.bankService.revertirAnterioresAMayo().subscribe({
      next: (res) => {
        this.revertirAntResult    = res;
        this.revirtandoAnteriores = false;
        if (res.revertidos > 0) this.refreshCards.emit();
      },
      error: (err) => {
        this.anteriorError        = err?.error?.error || 'Error al revertir identificación masiva';
        this.revirtandoAnteriores = false;
      },
    });
  }

  // ── Importar conciliación ──────────────────────────────────────────────────

  onImportarConciliacionFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    input.value = '';
    this.importandoConciliacion   = true;
    this.importConciliacionResult = null;
    this.revertConciliacionResult = null;
    this.importConciliacionError  = null;
    this.showFallidosConciliacion = false;
    this.bankService.importarConciliacion(file).subscribe({
      next: (res) => {
        this.importConciliacionResult = res;
        this.importandoConciliacion   = false;
        if (res.identificados > 0) this.refreshCards.emit();
      },
      error: (err) => {
        this.importConciliacionError = err?.error?.error || 'Error al importar el archivo de conciliación';
        this.importandoConciliacion  = false;
      },
    });
  }

  // ── Sync Saldo Transferencia ──────────────────────────────────────────────

  runSyncSaldoTransferencia(): void {
    this.saldoSyncStatus       = 'running';
    this.saldoSyncResult       = null;
    this.saldoSyncStopped      = null;
    this.saldoSyncError        = null;
    this.saldoSyncJobId        = null;
    this.saldoSyncPct          = 0;
    this.saldoSyncMsg          = 'Iniciando sincronización…';
    this.revertSaldoSyncResult = null;
    const desde = this.saldoSyncFechaDesde ? `${this.saldoSyncFechaDesde}T00:00:00.000Z` : undefined;
    const hasta = this.saldoSyncFechaHasta ? `${this.saldoSyncFechaHasta}T23:59:59.999Z` : undefined;
    this.bankService.syncSaldoTransferencia(desde, hasta).subscribe({
      next: ({ jobId }) => {
        this.saldoSyncJobId = jobId;
        sessionStorage.setItem('erpSaldoSyncJobId', jobId);
      },
      error: (err) => {
        this.saldoSyncError  = err?.error?.error || 'Error al iniciar la sincronización de saldo';
        this.saldoSyncStatus = 'idle';
        this.saldoSyncMsg    = null;
      },
    });
  }

  pauseSyncSaldoTransferencia(): void {
    this.bankService.pauseSyncSaldo().subscribe();
  }

  resumeSyncSaldoTransferencia(): void {
    this.bankService.resumeSyncSaldo().subscribe();
  }

  stopSyncSaldoTransferencia(): void {
    this.bankService.stopSyncSaldo().subscribe();
  }

  descargarReporteSaldoSync(jobId: string): void {
    if (this.descargandoReporteJobId) return;
    this.descargandoReporteJobId = jobId;
    this.bankService.downloadSaldoSyncReport(jobId).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href     = url;
        a.download = `sync-saldo-erp-${date}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.descargandoReporteJobId = null;
      },
      error: (err) => {
        this.saldoSyncError          = err?.error?.error || 'El reporte ya no está disponible (expiró).';
        this.descargandoReporteJobId = null;
      },
    });
  }

  runRevertirSaldoSync(jobId: string): void {
    if (this.revirtiendoJobId) return;
    const ok = confirm(
      '¿Revertir esta corrida de Sync Saldo ERP? Se restaurará el saldoErp anterior en todos ' +
      'los movimientos que esta corrida actualizó (excepto los que ya fueron tocados por una corrida más reciente).',
    );
    if (!ok) return;
    this.revirtiendoJobId = jobId;
    this.bankService.revertSaldoSync(jobId).subscribe({
      next: (res) => {
        this.revertSaldoSyncResult = {
          revertidos: res.revertidos,
          omitidosPorCorridaMasReciente: res.omitidosPorCorridaMasReciente,
        };
        this.revirtiendoJobId = null;
        if (res.revertidos > 0) this.refreshCards.emit();
        if (this.mostrarHistorialSaldo) this.cargarHistorialSaldoSync();
      },
      error: (err) => {
        this.saldoSyncError   = err?.error?.error || 'Error al revertir la corrida';
        this.revirtiendoJobId = null;
      },
    });
  }

  openResetCheckpointModal(): void {
    if (this.saldoSyncRunning) return;
    this.showResetCheckpointModal = true;
    this.resetCheckpointResult    = null;
    this.resetCheckpointError     = null;
  }

  closeResetCheckpointModal(): void {
    if (this.reiniciandoCheckpoint) return; // no cerrar mientras está en vuelo
    this.showResetCheckpointModal = false;
  }

  confirmResetCheckpoint(): void {
    if (this.reiniciandoCheckpoint) return;
    this.reiniciandoCheckpoint = true;
    this.resetCheckpointResult = null;
    this.resetCheckpointError  = null;
    const desde = this.saldoSyncFechaDesde ? `${this.saldoSyncFechaDesde}T00:00:00.000Z` : undefined;
    const hasta = this.saldoSyncFechaHasta ? `${this.saldoSyncFechaHasta}T23:59:59.999Z` : undefined;
    this.bankService.resetCheckpointSaldoSync(desde, hasta).subscribe({
      next: (res) => {
        this.resetCheckpointResult = { reiniciados: res.reiniciados };
        this.reiniciandoCheckpoint = false;
      },
      error: (err) => {
        this.resetCheckpointError  = err?.error?.error || 'Error al reiniciar el checkpoint';
        this.reiniciandoCheckpoint = false;
      },
    });
  }

  dismissSaldoSyncResult(): void {
    this.saldoSyncResult       = null;
    this.saldoSyncStopped      = null;
    this.revertSaldoSyncResult = null;
  }

  // ── Historial de corridas (permite recuperar una corrida que no sea la última) ──────

  toggleHistorialSaldoSync(): void {
    this.mostrarHistorialSaldo = !this.mostrarHistorialSaldo;
    if (this.mostrarHistorialSaldo) this.cargarHistorialSaldoSync();
  }

  cargarHistorialSaldoSync(): void {
    this.cargandoHistorialSaldo = true;
    this.bankService.getSaldoSyncJobs().subscribe({
      next: (jobs) => {
        this.saldoSyncHistory       = jobs;
        this.cargandoHistorialSaldo = false;
      },
      error: () => { this.cargandoHistorialSaldo = false; },
    });
  }

  /** Extrae y formatea la fecha/hora de un jobId con forma "saldo-sync-<timestamp>". */
  fechaDeJobId(jobId: string): string {
    const ms = Number(jobId.split('-').pop());
    if (!ms) return jobId;
    return new Date(ms).toLocaleString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  runRevertirConciliacion(): void {
    if (!this.importConciliacionResult?.runId) return;
    const runId = this.importConciliacionResult.runId;
    this.revirtandoConciliacion  = true;
    this.importConciliacionError = null;
    this.bankService.revertirConciliacion(runId).subscribe({
      next: (res) => {
        this.revertConciliacionResult = res;
        this.importConciliacionResult = null;
        this.showFallidosConciliacion = false;
        this.revirtandoConciliacion   = false;
        if (res.revertidos > 0) this.refreshCards.emit();
      },
      error: (err) => {
        this.importConciliacionError = err?.error?.error || 'Error al revertir la importación';
        this.revirtandoConciliacion  = false;
      },
    });
  }
}
