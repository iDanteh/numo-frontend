import { Component, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CollectionRequestService, CollectionRequest, ExtractedReceiptData } from '../../core/services/collection-request.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

type TabStatus = CollectionRequest['status'];
type AuthStage = 'searching' | 'match' | 'notfound';

const RECHAZO_MOTIVOS = [
  'No se encontró el movimiento en el banco',
  'El monto no coincide con el comprobante',
  'Comprobante ilegible o incompleto',
  'Otro motivo',
];

// Bancos activos en este Numo (mismo catálogo que usa banks.component.ts) —
// se ofrecen para que el usuario pueda cambiar de banco en la búsqueda manual
// si Kore lo mandó mal en la solicitud.
const BANCOS_DISPONIBLES = ['BBVA', 'Banamex', 'Santander', 'Azteca'];

// Ventana del auto-match inicial al abrir el modal. Deliberadamente asimétrica
// y amplia: una CxC puede saldarse con un depósito hecho días/semanas/meses
// antes (anticipos, pagos agrupados) — no tiene sentido asumir que el depósito
// cae cerca de la fecha en que Kore avisó la solicitud. Sigue siendo solo un
// punto de partida: la búsqueda manual permite cualquier rango.
const AUTO_SEARCH_DIAS_ANTES    = 60;
const AUTO_SEARCH_DIAS_DESPUES  = 15;

@Component({
  standalone: false,
  selector: 'app-collection-request',
  templateUrl: './collection-request.component.html',
})
export class CollectionRequestComponent implements OnInit, OnDestroy {

  solicitudes: CollectionRequest[] = [];
  loading  = false;
  loadError: string | null = null;

  activeTab: TabStatus = 'pendiente';

  readonly rechazoMotivos = RECHAZO_MOTIVOS;

  // Con collections:write ve la bandeja completa (cobranza/contabilidad/admin);
  // sin ese permiso solo ve lo que él mismo solicitó (GET /mias, rol tienda).
  // Se calcula en ngOnInit (no como field initializer) porque los parameter
  // properties del constructor (this.auth) aún no están asignados en ese punto.
  canReview = false;

  // ── Modal de conciliación (buscar en banco) ────────────────────────────────
  showAuthModal   = false;
  authTarget:     CollectionRequest | null = null;
  authStage:      AuthStage = 'searching';
  matchedMovement: any | null = null;
  showBankInline  = false;
  bankMovements:  any[] = [];
  authBusy        = false;

  // Búsqueda manual — banco y rango editables por el usuario (a diferencia del
  // auto-match, que usa un banco/rango fijo). Se precargan con lo que ya se
  // intentó automáticamente, pero el usuario puede cambiarlos libremente.
  readonly bancosDisponibles = BANCOS_DISPONIBLES;
  manualBanco:       string = '';
  manualFechaDesde:  string = '';
  manualFechaHasta:  string = '';
  manualSearchTerm:  string = '';
  manualSearching    = false;

  // Análisis del comprobante ya guardado (OCR + matching, mismo motor que
  // OcrModalComponent) — ayuda a ubicar el depósito cuando la búsqueda manual
  // por banco/fecha no es suficiente.
  ocrAnalyzing  = false;
  ocrExtracted: ExtractedReceiptData | null = null;

  // ── Modal de rechazo ────────────────────────────────────────────────────────
  showRejectModal = false;
  rejectTarget:    CollectionRequest | null = null;
  selectedReason:  string | null = null;
  rejectNote       = '';
  rejectShake      = false;
  rejectBusy       = false;

  // ── Modal de comprobante ──────────────────────────────────────────────────────
  showComprobanteModal = false;
  comprobanteUrl:  SafeResourceUrl | null = null;
  comprobanteMimetype: string | null = null;
  comprobanteLoading = false;
  private comprobanteRawUrl: string | null = null;

  // ── Modal de confirmación genérico (<app-modal>, reemplaza confirm() nativo) ──
  showConfirmModal    = false;
  confirmModalTitle   = '';
  confirmModalMessage = '';
  confirmModalDanger  = false;
  private confirmModalAction: (() => void) | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private svc:       CollectionRequestService,
    public  auth:      AuthService,
    private toast:     ToastService,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit(): void {
    this.canReview = this.auth.hasPermission('collections:write');
    this.reload();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.revokeComprobanteUrl();
  }

  // ── Carga de datos ────────────────────────────────────────────────────────────

  reload(): void {
    this.loading   = true;
    this.loadError = null;
    const fetch$ = this.canReview ? this.svc.list({ limit: 200 }) : this.svc.listMine({ limit: 200 });
    fetch$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.solicitudes = res.data || [];
        this.loading = false;
      },
      error: (err) => {
        this.loadError = err?.error?.error || 'No se pudieron cargar las solicitudes.';
        this.loading = false;
      },
    });
  }

  // ── Tabs y stats ────────────────────────────────────────────────────────────

  get filteredSolicitudes(): CollectionRequest[] {
    return this.solicitudes.filter(s => s.status === this.activeTab);
  }

  countByStatus(status: TabStatus): number {
    return this.solicitudes.filter(s => s.status === status).length;
  }

  private isToday(iso: string | null | undefined): boolean {
    if (!iso) return false;
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
  }

  get identificadasHoyCount(): number {
    return this.solicitudes.filter(s => s.status === 'identificada' && this.isToday(s.resueltoAt)).length;
  }

  get rechazadasHoyCount(): number {
    return this.solicitudes.filter(s => s.status === 'rechazada' && this.isToday(s.resueltoAt)).length;
  }

  get montoPendienteTotal(): number {
    return this.solicitudes
      .filter(s => s.status === 'pendiente')
      .reduce((acc, s) => acc + s.monto, 0);
  }

  setTab(tab: TabStatus): void {
    this.activeTab = tab;
  }

  // ── Helpers de presentación (derivan de cxcs[]/formasPago[], no hay columnas
  // planas de banco/cliente/folio en el backend — ver CollectionRequest.model.js) ─

  initials(name: string | null): string {
    const n = name || '—';
    return n.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  avatarColor(index: number): string {
    const palette = ['#3b82f6', '#0ea5a3', '#e0792b', '#d04a7a', '#8b5cf6', '#16a34a'];
    return palette[index % palette.length];
  }

  bancoLabel(s: CollectionRequest): string {
    const bancos = Array.from(new Set(s.formasPago.map(f => f.bancoDescripcion).filter((b): b is string => !!b)));
    return bancos.length ? bancos.join(', ') : '—';
  }

  private primerBanco(s: CollectionRequest): string | null {
    return s.formasPago.find(f => !!f.bancoDescripcion)?.bancoDescripcion ?? null;
  }

  formaPagoLabel(s: CollectionRequest): string {
    if (s.formasPago.length === 0) return '—';
    if (s.formasPago.length === 1) return s.formasPago[0].formaPagoDescripcion;
    return `Múltiple (${s.formasPago.length})`;
  }

  folioLabel(s: CollectionRequest): string {
    if (s.cxcs.length === 0) return '—';
    if (s.cxcs.length === 1) {
      const c = s.cxcs[0];
      return c.serie && c.folioExterno ? `${c.serie}-${c.folioExterno}` : (c.folioExterno || c.erpId);
    }
    return `${s.cxcs.length} CxC`;
  }

  clienteLabel(s: CollectionRequest): string {
    const nombres = Array.from(new Set(s.cxcs.map(c => c.nombrePersona).filter((n): n is string => !!n)));
    if (nombres.length === 0) return '—';
    if (nombres.length === 1) return nombres[0];
    return `${nombres[0]} y ${nombres.length - 1} más`;
  }

  private formatMoney(n: number): string {
    return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  // ── Comprobante ────────────────────────────────────────────────────────────────

  openComprobante(s: CollectionRequest): void {
    if (!s.comprobante?.tieneComprobante) return;
    this.comprobanteLoading   = true;
    this.comprobanteMimetype  = s.comprobante.mimetype;
    this.showComprobanteModal = true;
    this.svc.getComprobanteBlob(s._id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        this.revokeComprobanteUrl();
        this.comprobanteRawUrl = URL.createObjectURL(blob);
        // <iframe [src]> exige un SafeResourceUrl explícito — Angular lo rechaza
        // en runtime si se le pasa la blob URL cruda (contexto "resource URL").
        this.comprobanteUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.comprobanteRawUrl);
        this.comprobanteLoading = false;
      },
      error: () => {
        this.comprobanteLoading = false;
        this.toast.error('No se pudo cargar el comprobante.');
        this.showComprobanteModal = false;
      },
    });
  }

  closeComprobanteModal(): void {
    this.showComprobanteModal = false;
    this.revokeComprobanteUrl();
  }

  private revokeComprobanteUrl(): void {
    if (this.comprobanteRawUrl) URL.revokeObjectURL(this.comprobanteRawUrl);
    this.comprobanteRawUrl = null;
    this.comprobanteUrl = null;
  }

  // ── Modal de conciliación ───────────────────────────────────────────────────

  // Banco/rango "de fábrica" para la búsqueda confiable de banco+fecha — banco
  // de la solicitud (si es uno de los activos, si no el primero de la lista;
  // Kore pudo mandarlo mal, por eso es editable) y una ventana amplia y
  // asimétrica alrededor de cuándo se creó la solicitud (NO ±5 días). Se usa
  // al abrir el modal, y también para reponer el terreno si el OCR corrió
  // primero y no encontró nada — no hay que confiar en un banco/fecha que el
  // OCR haya extraído mal para la búsqueda de respaldo.
  private resetBusquedaDefaults(s: CollectionRequest): void {
    const bancoSolicitud  = this.primerBanco(s);
    this.manualBanco      = bancoSolicitud && this.bancosDisponibles.includes(bancoSolicitud)
      ? bancoSolicitud : this.bancosDisponibles[0];
    const base            = new Date(s.createdAt);
    this.manualFechaDesde = new Date(base.getTime() - AUTO_SEARCH_DIAS_ANTES   * 86400000).toISOString().slice(0, 10);
    this.manualFechaHasta = new Date(base.getTime() + AUTO_SEARCH_DIAS_DESPUES * 86400000).toISOString().slice(0, 10);
    this.manualSearchTerm = '';
  }

  openAuthModal(s: CollectionRequest): void {
    this.authTarget      = s;
    this.matchedMovement = null;
    this.showBankInline  = false;
    this.bankMovements   = [];
    this.ocrExtracted    = null;
    this.ocrAnalyzing    = false;

    this.resetBusquedaDefaults(s);
    this.showAuthModal = true;

    // Si la solicitud trae comprobante, el OCR entra primero — suele ser más
    // preciso que el auto-match por banco/fecha (usa la fecha/monto reales del
    // comprobante, no la fecha en que Kore avisó la solicitud). Si no hay
    // comprobante, o el análisis falla, se cae al auto-match de siempre.
    if (s.comprobante?.tieneComprobante) {
      this.analizarComprobante();
    } else {
      this.runAutoSearch();
    }
  }

  closeAuthModal(): void {
    if (this.authBusy) return;
    this.showAuthModal = false;
    this.authTarget     = null;
  }

  // Puerto exacto de _esFormaBancaria()/_norm() en cobro-panel.component.ts —
  // NO se basa en si la forma trae banco seleccionado (bancoKoreId): "depósito
  // en efectivo" normalmente no exige elegir banco y aun así cuenta como
  // bancaria. Se basa en el TEXTO de la descripción (transferencia o depósito
  // en efectivo); cheque, efectivo de caja, tarjeta, etc. no cuentan aquí
  // aunque sí liquiden la CxC — mismo criterio que usa el backend al calcular
  // erpLinks[].saldoPagado (ver _esFormaBancaria en collection-request.service.js).
  private esFormaBancaria(f: { formaPagoDescripcion: string }): boolean {
    const desc = f.formaPagoDescripcion || '';
    if (/transferencia/i.test(desc)) return true;
    const norm = desc.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    return /deposito.*efectivo/.test(norm);
  }

  // Suma solo las formas de pago bancarias (transferencia/depósito en
  // efectivo) — cuando el banco registra esa porción como su PROPIO depósito
  // separado del resto (cheque, efectivo de caja, etc.).
  private montoBancario(s: CollectionRequest): number {
    return s.formasPago
      .filter(f => this.esFormaBancaria(f))
      .reduce((acc, f) => acc + f.importe, 0);
  }

  // Un movimiento cuenta como "match exacto" si su depósito coincide con la
  // porción bancaria (transferencia+efectivo por separado) O con el monto
  // TOTAL de la solicitud (cheque/efectivo de caja incluidos combinados en un
  // solo depósito) — no sabemos de antemano cuál de los dos va a registrar el
  // banco, así que para la BÚSQUEDA (a diferencia del auto-match automático,
  // que sigue exigiendo ≥95% de confianza) se aceptan ambos como candidato.
  private esMatchExacto(m: any, s: CollectionRequest): boolean {
    const deposito = m.deposito ?? 0;
    return Math.abs(deposito - this.montoBancario(s)) < 1 || Math.abs(deposito - s.monto) < 1;
  }

  // Cuando el auto-match no encuentra nada, no tiene mucho sentido repetir la
  // misma búsqueda automática — se abre el panel de búsqueda manual (banco y
  // fechas editables, ya precargados con lo que se intentó).
  openManualSearch(): void {
    this.showBankInline = true;
  }

  private runAutoSearch(): void {
    if (!this.authTarget) return;
    const target = this.authTarget;
    this.authStage = 'searching';

    this.svc.listBankMovements({
      banco:       this.manualBanco || undefined,
      tipo:        'deposito',
      fechaInicio: this.manualFechaDesde,
      fechaFin:    this.manualFechaHasta,
      limit:       100,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.bankMovements = res.data || [];
        const exact = this.bankMovements.find(m => this.esMatchExacto(m, target));
        if (exact) {
          this.matchedMovement = exact;
          this.authStage = 'match';
        } else {
          this.authStage = 'notfound';
        }
      },
      error: () => {
        this.bankMovements = [];
        this.authStage = 'notfound';
      },
    });
  }

  // Búsqueda manual: mismo endpoint, pero con banco/fechas/término que el
  // usuario controla — puede corregir el banco si Kore lo mandó mal, ampliar
  // el rango de fechas, o buscar por monto/referencia/concepto (parámetro
  // `search`, ya soportado por GET /api/banks/movements).
  buscarManual(): void {
    if (!this.authTarget) return;
    const target = this.authTarget;
    this.manualSearching = true;

    this.svc.listBankMovements({
      banco:       this.manualBanco || undefined,
      tipo:        'deposito',
      fechaInicio: this.manualFechaDesde || undefined,
      fechaFin:    this.manualFechaHasta || undefined,
      search:      this.manualSearchTerm || undefined,
      limit:       100,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.bankMovements   = res.data || [];
        this.manualSearching = false;
        const exact = this.bankMovements.find(m => this.esMatchExacto(m, target));
        this.matchedMovement = exact ?? null;
        if (exact) this.authStage = 'match';
      },
      error: () => {
        this.manualSearching = false;
        this.bankMovements   = [];
      },
    });
  }

  toggleBankInline(): void {
    this.showBankInline = !this.showBankInline;
  }

  // Corre OCR + matching sobre el comprobante ya guardado en la solicitud (no
  // hace falta volver a subirlo). Reusa el mismo motor que OcrModalComponent
  // en Bancos (Gemini/Vision/Tesseract + scoring por monto/fecha). Los
  // candidatos ya vienen rankeados (score/nivel) — se muestran en la misma
  // lista de movimientos, y se precarga la búsqueda manual con lo extraído
  // por si el usuario quiere refinar.
  analizarComprobante(): void {
    if (!this.authTarget) return;
    const target = this.authTarget;
    this.ocrAnalyzing = true;
    this.authStage    = 'searching';

    this.svc.analyzeComprobante(target._id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.ocrAnalyzing  = false;
        this.ocrExtracted  = res.extracted;
        this.bankMovements = res.candidates.map(c => ({
          ...c.movement, _ocrScore: c.score, _ocrNivel: c.nivel, _ocrReasons: c.reasons,
        }));
        this.showBankInline = true;

        if (res.extracted.fecha) {
          const base = new Date(res.extracted.fecha);
          this.manualFechaDesde = new Date(base.getTime() - 5 * 86400000).toISOString().slice(0, 10);
          this.manualFechaHasta = new Date(base.getTime() + 5 * 86400000).toISOString().slice(0, 10);
        }
        const bancoDetectado = this._mapBancoOcr(res.extracted.bancoOrigen) ?? this._mapBancoOcr(res.extracted.bancoDestino);
        if (bancoDetectado) this.manualBanco = bancoDetectado;
        this.manualSearchTerm = res.extracted.numeroAutorizacion || res.extracted.claveRastreo || res.extracted.referencia || '';

        const top = this.bankMovements.find(m => m._ocrNivel === 'alto');
        const exacto = this.bankMovements.find(m => this.esMatchExacto(m, target));
        const elegido = exacto ?? top ?? null;
        if (elegido) {
          this.matchedMovement = elegido;
          this.authStage = 'match';
        } else {
          // El OCR corrió bien pero no encontró nada con suficiente confianza —
          // su búsqueda es más angosta que la de siempre (usa el monto/fecha que
          // el OCR extrajo, con tolerancia chica; si se equivocó por poco, el
          // movimiento correcto ni siquiera entra a sus candidatos). Antes de
          // rendirse, se repone el banco/rango de fechas "de fábrica" (NO el que
          // el OCR haya detectado, por si se equivocó también en eso) y se cae a
          // la búsqueda confiable de banco+fecha — la misma que corría siempre
          // antes de que el OCR entrara primero.
          this.matchedMovement = null;
          this.resetBusquedaDefaults(target);
          this.runAutoSearch();
        }
      },
      error: (err) => {
        this.ocrAnalyzing = false;
        this.toast.error(err?.error?.error || 'No se pudo analizar el comprobante — se sigue con la búsqueda por banco y fecha.');
        // El OCR falló (servicio caído, comprobante ilegible, etc.) — no dejar
        // al usuario sin nada, caer al auto-match de banco/fecha de siempre.
        this.runAutoSearch();
      },
    });
  }

  // Coincidencia simple contra el catálogo de bancos activos (no un mapeo
  // exhaustivo Kore/OCR↔Numo) — si el nombre que dio el OCR incluye alguno de
  // los 4 bancos activos, se usa; si no, el usuario lo corrige a mano.
  private _mapBancoOcr(nombre: string | null): string | null {
    if (!nombre) return null;
    const norm = nombre.toUpperCase();
    return this.bancosDisponibles.find(b => norm.includes(b.toUpperCase())) ?? null;
  }

  askAuthorize(): void {
    if (!this.authTarget || !this.matchedMovement) return;
    const s = this.authTarget;
    this.askConfirm(
      'Autorizar e identificar',
      `Se identificará el movimiento en el banco y se autorizará el cobro de ${this.folioLabel(s)} por ` +
      `${this.formatMoney(s.monto)}. La acción quedará registrada.`,
      () => this.authorizeSolicitud(this.matchedMovement),
    );
  }

  identifyMovement(mov: any): void {
    if (!this.authTarget) return;
    const s = this.authTarget;
    this.askConfirm(
      'Identificar movimiento',
      `Se vinculará este movimiento del banco con ${this.folioLabel(s)} por ${this.formatMoney(s.monto)} ` +
      `y se autorizará el cobro.`,
      () => this.authorizeSolicitud(mov),
    );
  }

  relateMovement(mov: any): void {
    if (!this.authTarget) return;
    const s = this.authTarget;
    const diff = (mov.deposito ?? 0) - s.monto;
    let detail: string;
    if (Math.abs(diff) < 0.005) {
      detail = 'El monto coincide con la cuenta por cobrar.';
    } else if (diff > 0) {
      detail = `El movimiento es mayor que la cuenta por cobrar por ${this.formatMoney(Math.abs(diff))}.`;
    } else {
      detail = `El movimiento es menor que la cuenta por cobrar por ${this.formatMoney(Math.abs(diff))}. Se registrará como pago parcial.`;
    }
    this.askConfirm(
      'Relacionar movimiento',
      `${detail} Se relacionará ${this.folioLabel(s)} (${this.formatMoney(s.monto)}) con este movimiento ` +
      `del banco (${this.formatMoney(mov.deposito ?? 0)}).`,
      () => this.authorizeSolicitud(mov),
    );
  }

  // ── Modal de confirmación genérico ───────────────────────────────────────────

  private askConfirm(title: string, message: string, action: () => void, danger = false): void {
    this.confirmModalTitle   = title;
    this.confirmModalMessage = message;
    this.confirmModalDanger  = danger;
    this.confirmModalAction  = action;
    this.showConfirmModal    = true;
  }

  confirmModalAccept(): void {
    const action = this.confirmModalAction;
    this.showConfirmModal   = false;
    this.confirmModalAction = null;
    if (action) action();
  }

  confirmModalCancel(): void {
    this.showConfirmModal   = false;
    this.confirmModalAction = null;
  }

  private authorizeSolicitud(mov: any): void {
    if (!this.authTarget) return;
    const s = this.authTarget;
    this.authBusy = true;
    this.svc.identificar(s._id, mov._id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.authBusy = false;
        this.closeAuthModal();
        this.toast.success(`Se identificó y concilió el cobro de ${this.folioLabel(s)} por ${this.formatMoney(s.monto)}.`);
        this.reload();
      },
      error: (err) => {
        this.authBusy = false;
        this.toast.error(err?.error?.error || 'No se pudo identificar la solicitud.');
      },
    });
  }

  // ── Modal de rechazo ────────────────────────────────────────────────────────

  rejectFromAuthModal(): void {
    const preset = this.authStage === 'notfound' ? RECHAZO_MOTIVOS[0] : undefined;
    const target = this.authTarget;
    this.closeAuthModal();
    if (target) this.openRejectModal(target, preset);
  }

  openRejectModal(s: CollectionRequest, presetReason?: string): void {
    this.rejectTarget   = s;
    this.selectedReason = presetReason || null;
    this.rejectNote      = '';
    this.showRejectModal = true;
  }

  closeRejectModal(): void {
    if (this.rejectBusy) return;
    this.showRejectModal = false;
    this.rejectTarget     = null;
  }

  selectReason(reason: string): void {
    this.selectedReason = reason;
  }

  askReject(): void {
    if (!this.rejectTarget) return;
    if (!this.selectedReason) {
      this.rejectShake = true;
      setTimeout(() => this.rejectShake = false, 300);
      return;
    }
    const s = this.rejectTarget;
    this.askConfirm(
      'Rechazar solicitud',
      `Se rechazará la solicitud de ${this.folioLabel(s)}. Motivo: ${this.selectedReason}.`,
      () => this.rejectSolicitud(),
      true,
    );
  }

  private rejectSolicitud(): void {
    if (!this.rejectTarget || !this.selectedReason) return;
    const s = this.rejectTarget;
    const motivo = this.rejectNote ? `${this.selectedReason} — ${this.rejectNote}` : this.selectedReason;
    this.rejectBusy = true;
    this.svc.rechazar(s._id, motivo).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.rejectBusy = false;
        this.toast.error(`Se rechazó la solicitud de ${this.folioLabel(s)}.`);
        this.closeRejectModal();
        this.reload();
      },
      error: (err) => {
        this.rejectBusy = false;
        this.toast.error(err?.error?.error || 'No se pudo rechazar la solicitud.');
      },
    });
  }
}
