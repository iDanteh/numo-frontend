import { Component, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CollectionRequestService, CollectionRequest, AnalyzeComprobanteResult, CxCSolicitud } from '../../core/services/collection-request.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { SocketService } from '../../core/services/socket.service';

type TabStatus = CollectionRequest['status'];
type AuthStage = 'searching' | 'match' | 'ambiguous' | 'notfound';

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

  // Detalle de CxC (solo aplica con más de una): colapsado por defecto — es
  // información secundaria de auditoría, no hace falta abrir el modal con ella
  // ya desplegada. El usuario decide si quiere verla.
  showCxcDetail   = false;

  // Búsqueda manual — banco y rango editables por el usuario (a diferencia del
  // auto-match, que usa un banco/rango fijo). Se precargan con lo que ya se
  // intentó automáticamente, pero el usuario puede cambiarlos libremente.
  readonly bancosDisponibles = BANCOS_DISPONIBLES;
  manualBanco:       string = '';
  manualFechaDesde:  string = '';
  manualFechaHasta:  string = '';
  manualSearchTerm:  string = '';
  manualSearching    = false;

  // Análisis de los comprobantes ya guardados (OCR + matching, mismo motor que
  // OcrModalComponent) — ayuda a ubicar el depósito cuando la búsqueda manual
  // por banco/fecha no es suficiente. Un resultado POR comprobante — nunca se
  // combinan los montos extraídos entre archivos, cada uno puede corresponder
  // a un depósito distinto.
  ocrAnalyzing  = false;
  ocrResultados: AnalyzeComprobanteResult[] = [];

  // ── Modal de rechazo ────────────────────────────────────────────────────────
  showRejectModal = false;
  rejectTarget:    CollectionRequest | null = null;
  selectedReason:  string | null = null;
  rejectNote       = '';
  rejectShake      = false;
  rejectBusy       = false;

  // ── Modal de comprobante (galería — puede haber varios por solicitud) ────────
  showComprobanteModal = false;
  comprobanteUrl:  SafeResourceUrl | null = null;
  comprobanteMimetype: string | null = null;
  comprobanteLoading = false;
  comprobanteIndex = 0;
  comprobanteTotal = 0;
  // Público (no private): el template del modal de comprobante lo usa para mostrar a qué
  // solicitud pertenece (solicitudIdErp, folio, cliente) — ver openComprobante().
  comprobanteTarget: CollectionRequest | null = null;
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
    private socketSvc: SocketService,
  ) {}

  ngOnInit(): void {
    this.canReview = this.auth.hasPermission('collections:write');
    this.reload();

    // Tiempo real: si otra sesión (u otro usuario) identifica/rechaza una
    // solicitud mientras esta bandeja está abierta, se refleja sin recargar.
    // Solo parchea la fila si ya está en el arreglo local — emitToAll llega a
    // todos los conectados, así que en "mis solicitudes" (rol tienda) puede
    // llegar un evento de una solicitud ajena, que simplemente se ignora.
    this.socketSvc.collectionRequestUpdated$.pipe(takeUntil(this.destroy$)).subscribe(updated => {
      const idx = this.solicitudes.findIndex(s => s._id === updated._id);
      if (idx === -1) return;
      this.solicitudes[idx] = { ...this.solicitudes[idx], ...updated } as CollectionRequest;
      this.solicitudes = [...this.solicitudes];
    });

    // Tiempo real: Kore crea la solicitud con un POST directo a Numo — este evento
    // avisa a quien tenga la bandeja abierta sin que tenga que recargar a mano.
    // En "mis solicitudes" (rol tienda) se descarta la que no sea propia — mismo
    // criterio que el handler de arriba, emitToAll llega a todos los conectados.
    this.socketSvc.collectionRequestCreated$.pipe(takeUntil(this.destroy$)).subscribe(created => {
      if (!this.canReview && created.solicitanteUserId !== this.auth.currentUser.id) return;
      if (this.solicitudes.some(s => s._id === created._id)) return;
      this.solicitudes = [created, ...this.solicitudes];
    });
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

  // Monto que aporta una CxC individual a la solicitud: en Modo 2 (varias CxC) es
  // `montoAsignado`; en una solicitud de una sola CxC ese campo viene null y el monto
  // completo es directamente `total`. Mismo criterio en cualquier lugar que liste CxC.
  montoCxc(c: CxCSolicitud): number {
    return c.montoAsignado ?? c.total ?? 0;
  }

  cxcFolio(c: CxCSolicitud): string {
    return c.serie && c.folioExterno ? `${c.serie}-${c.folioExterno}` : (c.folioExterno || c.erpId);
  }

  // Copia un identificador (solicitudIdErp, folio de CxC, etc.) al portapapeles con
  // feedback inmediato — pensado para que el usuario pueda pegarlo directo en Kore o en
  // una conversación de soporte al rastrear una solicitud.
  copyToClipboard(text: string | null | undefined, label = 'Identificador'): void {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => this.toast.success(`${label} copiado: ${text}`),
      () => this.toast.error('No se pudo copiar al portapapeles.'),
    );
  }

  // ── Comprobante ────────────────────────────────────────────────────────────────

  // Cuántos comprobantes tiene una solicitud, sin importar si son legacy
  // (Mongo, uno) o nuevos (Drive, uno o varios) — tieneComprobante ya viene
  // UNIFICADO desde el backend, así que basta con tomar el máximo entre ambos.
  numComprobantes(s: CollectionRequest): number {
    return Math.max(s.comprobantes?.length ?? 0, s.comprobante?.tieneComprobante ? 1 : 0);
  }

  openComprobante(s: CollectionRequest, index: number = 0): void {
    const total = this.numComprobantes(s);
    if (total === 0) return;
    this.comprobanteTarget    = s;
    this.comprobanteTotal     = total;
    this.comprobanteIndex     = Math.min(Math.max(index, 0), total - 1);
    this.showComprobanteModal = true;
    this._cargarComprobanteActual();
  }

  comprobanteAnterior(): void {
    if (this.comprobanteIndex <= 0) return;
    this.comprobanteIndex--;
    this._cargarComprobanteActual();
  }

  comprobanteSiguiente(): void {
    if (this.comprobanteIndex >= this.comprobanteTotal - 1) return;
    this.comprobanteIndex++;
    this._cargarComprobanteActual();
  }

  private _cargarComprobanteActual(): void {
    const s = this.comprobanteTarget;
    if (!s) return;
    this.comprobanteLoading  = true;
    this.comprobanteMimetype = s.comprobantes?.[this.comprobanteIndex]?.mimetype ?? s.comprobante?.mimetype ?? null;

    this.svc.getComprobanteBlob(s._id, this.comprobanteIndex).pipe(takeUntil(this.destroy$)).subscribe({
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
      },
    });
  }

  closeComprobanteModal(): void {
    this.showComprobanteModal = false;
    this.comprobanteTarget    = null;
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
    this.showCxcDetail   = false;
    this.bankMovements   = [];
    this.ocrResultados   = [];
    this.ocrAnalyzing    = false;

    this.resetBusquedaDefaults(s);
    this.showAuthModal = true;

    // Si la solicitud trae comprobante, el OCR entra primero — suele ser más
    // preciso que el auto-match por banco/fecha (usa la fecha/monto reales del
    // comprobante, no la fecha en que Kore avisó la solicitud). Si no hay
    // comprobante, o el análisis falla, se cae al auto-match de siempre.
    if (this.numComprobantes(s) > 0) {
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
  // bancaria. Se basa en el TEXTO de la descripción: transferencia, cheque o
  // depósito en efectivo cuentan como bancaria; efectivo de caja, tarjeta,
  // compensación, etc. no, aunque sí liquiden la CxC — mismo criterio que usa
  // el backend al calcular erpLinks[].saldoPagado (ver esFormaBancaria en
  // collection-request-erp-links.js).
  private esFormaBancaria(f: { formaPagoDescripcion: string }): boolean {
    const desc = f.formaPagoDescripcion || '';
    if (/transferencia/i.test(desc)) return true;
    if (/cheque/i.test(desc)) return true;
    const norm = desc.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    return /deposito.*efectivo/.test(norm);
  }

  // Suma solo las formas de pago bancarias (transferencia/cheque/depósito en
  // efectivo) — cuando el banco registra esa porción como su PROPIO depósito
  // separado del resto (efectivo de caja, tarjeta, etc.).
  private montoBancario(s: CollectionRequest): number {
    return s.formasPago
      .filter(f => this.esFormaBancaria(f))
      .reduce((acc, f) => acc + f.importe, 0);
  }

  // Clasifica por qué un movimiento cuenta como candidato válido para la
  // BÚSQUEDA (a diferencia del auto-match automático — eliminado, ver
  // askAuthorize/identifyMovement/relateMovement: siempre requiere que un
  // humano confirme con "Autorizar e identificar"):
  //  - 'bancario'/'total': su depósito coincide con la porción bancaria de la
  //    solicitud o con el monto TOTAL.
  //  - 'ocr': coincide con lo que el OCR leyó de ALGUNO de los comprobantes —
  //    evidencia directa de lo realmente transferido, aunque no calce con el
  //    total de ESTA solicitud (un comprobante puede cubrir varias solicitudes,
  //    o solo una parte de esta si hay varios comprobantes/depósitos).
  //
  // NO se incluye un caso "excedente" (depósito mayor a lo solicitado, ej.
  // cliente deja saldo a propósito para futuras CxC) — se probó y se revirtió:
  // sin ninguna corroboración (comprobante/referencia), "cualquier depósito
  // mayor" hace match contra depósitos de OTRAS transacciones sin relación
  // (caso real: solicitud de $3,703.64 emparejada con un depósito ajeno de
  // $4,336.00). Ese caso de negocio sigue sin resolver — si se retoma, un
  // humano siempre puede usar "Relacionar" manualmente sobre cualquier
  // movimiento de la lista, con o sin este método.
  private matchKind(m: any, s: CollectionRequest): 'bancario' | 'total' | 'ocr' | null {
    const deposito = m.deposito ?? 0;
    const bancario = this.montoBancario(s);

    if (Math.abs(deposito - bancario) < 1) return 'bancario';
    if (Math.abs(deposito - s.monto) < 1) return 'total';
    if (this.ocrResultados.some(r => r.extracted.monto != null && Math.abs(deposito - r.extracted.monto) < 1)) return 'ocr';
    return null;
  }

  private esMatchExacto(m: any, s: CollectionRequest): boolean {
    return this.matchKind(m, s) !== null;
  }

  // Un movimiento con una CxC de OTRA solicitud ya enganchada no cuenta como candidato
  // libre, aunque su `status` siga en 'no_identificado' (aplicarLogicaErp lo deja así
  // mientras el saldoErp acumulado no cubra el depósito completo — un depósito puede
  // tener una CxC ajena parcialmente vinculada sin que el status llegue a 'identificado'
  // todavía). Sin esto, el filtro por status solo no bastaba para excluirlo. Un
  // movimiento sin erpIds, o cuyos erpIds sean TODOS de esta misma solicitud (reintento),
  // sigue contando como libre.
  private sinCxcAjena(m: any, s: CollectionRequest): boolean {
    const erpIds = m.erpIds as string[] | undefined;
    if (!erpIds || erpIds.length === 0) return true;
    const propios = new Set(s.cxcs.map(c => c.erpId));
    return erpIds.every(id => propios.has(id));
  }

  // Coincidencia exclusiva del análisis por comprobante: el depósito debe coincidir con
  // el monto que el OCR extrajo de ESE comprobante específico — a diferencia de
  // matchKind()/esMatchExacto(), aquí NUNCA se compara contra el monto bancario/total de
  // toda la solicitud, porque un comprobante puede cubrir solo una parte de lo
  // solicitado (varios depósitos distintos) y comparar contra el total daría falsos
  // positivos (ver hallazgo 2026-07-09: la "sugerencia" salía del monto solicitado, no
  // de lo que decía la imagen del comprobante).
  private esMatchComprobante(m: any): boolean {
    const resultado = this.ocrResultados[m._comprobanteIndex];
    const monto = resultado?.extracted?.monto;
    if (monto == null) return false;
    return Math.abs((m.deposito ?? 0) - monto) < 1;
  }

  // Puede haber varios depósitos con el mismo importe (ej. 3 depósitos de
  // $10,000 el mismo día) — auto-seleccionar a ciegas el primero que cumpla el
  // criterio arriesgaría vincular la CxC al movimiento equivocado. Cuando hay
  // más de un candidato, NINGUNO se auto-selecciona: se marca 'ambiguo' y el
  // usuario elige a mano con "Relacionar" (banco/fecha/referencia como
  // desempate). Con exactamente 1 candidato, ese sí se auto-selecciona.
  private unicoCandidato(candidatos: any[]): any | 'ambiguo' | null {
    if (candidatos.length === 1) return candidatos[0];
    if (candidatos.length > 1)  return 'ambiguo';
    return null;
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
      status:      'no_identificado',
      limit:       100,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        const fetched     = (res.data || []).filter(m => this.sinCxcAjena(m, target));
        const candidatos  = fetched.filter(m => this.esMatchExacto(m, target));
        const resultado   = this.unicoCandidato(candidatos);
        if (resultado === 'ambiguo') {
          // Mostrar SOLO los candidatos que realmente empatan en monto — no
          // los ~100 movimientos del rango completo (eso es lo que ofrece
          // "Búsqueda manual" si esta sugerencia no alcanza).
          this.bankMovements = candidatos;
          this.matchedMovement = null;
          this.authStage = 'ambiguous';
          this.showBankInline = true;
        } else if (resultado) {
          this.bankMovements = fetched;
          this.matchedMovement = resultado;
          this.authStage = 'match';
        } else {
          this.bankMovements = fetched;
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
      status:      'no_identificado',
      limit:       100,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.bankMovements   = (res.data || []).filter(m => this.sinCxcAjena(m, target));
        this.manualSearching = false;
        const resultado = this.unicoCandidato(this.bankMovements.filter(m => this.esMatchExacto(m, target)));
        if (resultado === 'ambiguo') {
          this.matchedMovement = null;
          this.authStage = 'ambiguous';
        } else if (resultado) {
          this.matchedMovement = resultado;
          this.authStage = 'match';
        } else {
          this.matchedMovement = null;
        }
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

  toggleCxcDetail(): void {
    this.showCxcDetail = !this.showCxcDetail;
  }

  // Corre OCR + matching sobre CADA comprobante ya guardado en la solicitud (no
  // hace falta volver a subirlos). Reusa el mismo motor que OcrModalComponent
  // en Bancos (Gemini/Vision/Tesseract + scoring por monto/fecha). Cada
  // comprobante se analiza de forma INDEPENDIENTE — nunca se combinan sus
  // montos extraídos entre sí — pero sus candidatos SÍ se juntan en una sola
  // lista visible (cada fila queda etiquetada con `_comprobanteIndex`), porque
  // hoy una solicitud solo puede identificarse contra UN movimiento a la vez.
  analizarComprobante(): void {
    if (!this.authTarget) return;
    const target = this.authTarget;
    this.ocrAnalyzing = true;
    this.authStage    = 'searching';

    this.svc.analyzeComprobante(target._id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (resultados) => {
        this.ocrAnalyzing  = false;
        this.ocrResultados = resultados;
        this.bankMovements = resultados.flatMap(r => r.candidates.map(c => ({
          ...c.movement, _ocrScore: c.score, _ocrNivel: c.nivel, _ocrReasons: c.reasons,
          _comprobanteIndex: r.comprobanteIndex,
        })));
        this.showBankInline = true;

        // Precarga la búsqueda manual con lo que haya extraído el primer
        // comprobante que sí logró leer algo — sigue siendo solo un punto de
        // partida editable, no una verdad absoluta.
        const primero = resultados.find(r => r.extracted.monto != null || r.extracted.fecha) ?? resultados[0];
        if (primero?.extracted.fecha) {
          const base = new Date(primero.extracted.fecha);
          this.manualFechaDesde = new Date(base.getTime() - 5 * 86400000).toISOString().slice(0, 10);
          this.manualFechaHasta = new Date(base.getTime() + 5 * 86400000).toISOString().slice(0, 10);
        }
        const bancoDetectado = primero
          ? this._mapBancoOcr(primero.extracted.bancoOrigen) ?? this._mapBancoOcr(primero.extracted.bancoDestino)
          : null;
        if (bancoDetectado) this.manualBanco = bancoDetectado;
        this.manualSearchTerm = primero?.extracted.numeroAutorizacion || primero?.extracted.claveRastreo || primero?.extracted.referencia || '';

        // Solo el monto que el OCR leyó de CADA comprobante — nunca el monto
        // bancario/total de la solicitud completa (ver esMatchComprobante): un
        // comprobante puede cubrir solo una parte de lo solicitado.
        const exactos = this.bankMovements.filter(m => this.esMatchComprobante(m));
        const altos   = this.bankMovements.filter(m => m._ocrNivel === 'alto');
        // Se evalúa primero el match exacto por monto; solo si no hay ninguno
        // se recurre a los de confianza OCR "alta" — igual que antes.
        const empatados = exactos.length > 0 ? exactos : altos;
        const resultado = this.unicoCandidato(empatados);
        if (resultado === 'ambiguo') {
          // Más de un candidato igual de válido (mismo importe, o varios con
          // confianza OCR "alta") — no se adivina. Se acota la lista visible a
          // solo los empatados (no los ~10 candidatos rankeados completos) y el
          // usuario elige a mano.
          this.bankMovements = empatados;
          this.matchedMovement = null;
          this.authStage = 'ambiguous';
        } else if (resultado) {
          this.matchedMovement = resultado;
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
