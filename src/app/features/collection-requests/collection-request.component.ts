import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import {
  CollectionRequestService, CollectionRequest, AnalyzeComprobanteResult, CxCSolicitud,
  CollectionRequestListParams, CollectionRequestPagination, CollectionRequestStats,
} from '../../core/services/collection-request.service';
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

  // ── Búsqueda, rango de fecha y paginación real (2026-07-29) ─────────────────
  // Antes reload() pedía hasta 200 solicitudes SIN filtrar por status y
  // filteredSolicitudes las recortaba en memoria por pestaña — no escalaba (y
  // menos con search/fecha encima). Ahora activeTab/search/fecha viajan al
  // backend como filtros reales y el backend regresa solo la página pedida.
  searchTerm = '';
  private search$ = new Subject<string>();
  fechaInicio = '';
  fechaFin    = '';
  pagination: CollectionRequestPagination = { total: 0, page: 1, limit: 50, pages: 0 };

  // Reporte Excel descargable (solo Autorizadas/Rechazadas, ver descargarReporte) —
  // vive en la barra de filtros compartida, no depende de qué pestaña esté activa.
  generandoReporte = false;

  // Conteos (Pendientes/Identificadas/Rechazadas, "hoy", monto pendiente) —
  // con paginación real por status, this.solicitudes ya NO trae todos los
  // estatus a la vez, así que estos conteos se piden aparte (GET .../stats),
  // sobre el universo completo, no la página actual. Ver reloadStats().
  private statsData: CollectionRequestStats | null = null;

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
  showFpDetail    = false;

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
  comprobanteZoomed = false;
  private _comprobanteZoomFocus: { xFrac: number; yFrac: number } | null = null;
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

    // Buscador — mismo debounce que usa Bancos (400ms) para no disparar una
    // consulta por cada tecla; distinctUntilChanged evita repetir la misma
    // búsqueda si el usuario borra y vuelve a escribir lo mismo.
    this._wireSearch();

    // Tiempo real: si otra sesión (u otro usuario) identifica/rechaza una
    // solicitud mientras esta bandeja está abierta, se refleja sin recargar.
    // Solo parchea la fila si ya está en el arreglo local — emitToAll llega a
    // todos los conectados, así que en "mis solicitudes" (rol tienda) puede
    // llegar un evento de una solicitud ajena, que simplemente se ignora.
    this.socketSvc.collectionRequestUpdated$.pipe(takeUntil(this.destroy$)).subscribe(updated => {
      const idx = this.solicitudes.findIndex(s => s._id === updated._id);
      if (idx === -1) return;
      if (updated.status === this.activeTab) {
        this.solicitudes[idx] = { ...this.solicitudes[idx], ...updated } as CollectionRequest;
        this.solicitudes = [...this.solicitudes];
      } else {
        // Cambió a un status que ya no es el de esta pestaña — con paginación real
        // por status (2026-07-29), la fila debe desaparecer de la vista. Antes se
        // ocultaba sola vía filteredSolicitudes (filtro en memoria); ahora
        // this.solicitudes YA es la página filtrada que regresó el backend.
        this.solicitudes = this.solicitudes.filter(s => s._id !== updated._id);
      }
      this.reloadStats();

      // Si el modal de conciliación está abierto justo para ESTA solicitud y OTRA
      // sesión la resolvió mientras tanto, cerrarlo con aviso — sin esto, el usuario
      // podía dar clic en "Autorizar"/"Identificar" sobre una solicitud ya resuelta y
      // solo enterarse por el error genérico del guard del backend (identificar()/
      // rechazar(), status !== 'pendiente'). closeAuthModal() ya respeta authBusy (no
      // cierra a media acción propia en curso) — no se duplica esa guardia aquí.
      //
      // resueltoPorUserId !== mi propio id — fix 2026-07-28: emitToAll manda este
      // evento a TODOS los conectados, incluida la MISMA pestaña que acaba de
      // resolver la solicitud. El socket suele llegar antes que la respuesta HTTP
      // de authorizeSolicitud()/rejectFromAuthModal() (que recién ahí cierra el
      // modal) — sin este chequeo, un usuario veía "ya fue identificada por <su
      // propio nombre> mientras la tenías abierta" sobre SU PROPIA acción exitosa.
      // Una cancelación SIEMPRE viene de Kore (nunca de esta misma sesión de
      // Numo), así que ahí el chequeo no aplica — siempre se avisa.
      const resueltoPorOtro = updated.status === 'cancelada'
        ? true
        : updated.resueltoPorUserId !== this.auth.currentUser.id;
      if (this.showAuthModal && this.authTarget?._id === updated._id && updated.status !== 'pendiente' && resueltoPorOtro) {
        const accion = updated.status === 'identificada' ? 'identificada'
          : updated.status === 'cancelada' ? 'cancelada' : 'rechazada';
        const quienNombre = updated.status === 'cancelada' ? updated.canceladoPorNombre : updated.resueltoPorNombre;
        const quien = quienNombre ? ` por ${quienNombre}` : (updated.status === 'cancelada' ? ' desde Kore' : ' en otra sesión');
        this.toast.warning(`Esta solicitud ya fue ${accion}${quien} mientras la tenías abierta.`);
        this.closeAuthModal();
      }
    });

    // Tiempo real: Kore crea la solicitud con un POST directo a Numo — este evento
    // avisa a quien tenga la bandeja abierta sin que tenga que recargar a mano.
    // En "mis solicitudes" (rol tienda) se descarta la que no sea propia — mismo
    // criterio que el handler de arriba, emitToAll llega a todos los conectados.
    this.socketSvc.collectionRequestCreated$.pipe(takeUntil(this.destroy$)).subscribe(created => {
      if (!this.canReview && created.solicitanteUserId !== this.auth.currentUser.id) return;
      if (this.solicitudes.some(s => s._id === created._id)) return;
      // Una solicitud nueva siempre nace 'pendiente' — solo se agrega a la vista si
      // esa es la pestaña activa (con paginación real por status, this.solicitudes
      // ya es la página filtrada; no tiene sentido insertar una fila que no
      // corresponde al filtro actual).
      if (created.status === this.activeTab) {
        // Al FINAL, no al principio — la bandeja (list()) ordena más antigua primero
        // (2026-07-24); una solicitud recién creada es la más nueva, así que le toca
        // el último lugar de la cola, no saltarse a las que ya estaban esperando.
        this.solicitudes = [...this.solicitudes, created];
      }
      this.reloadStats();
    });

    // Si un admin le cambia el rol a este usuario mientras tiene la bandeja
    // abierta, AuthService actualiza this.auth (permissions) en caliente pero
    // NO navega si la ruta actual sigue siendo accesible (collections:read se
    // conserva incluso bajando a tienda) — así que sin esto, un usuario que
    // pasó de admin/contabilidad/cobranza a tienda seguiría viendo la bandeja
    // completa (list) hasta recargar la página. Se recalcula canReview y, si
    // cambió, se recarga con el endpoint que corresponde al rol nuevo.
    this.socketSvc.roleUpdated$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      const canReviewNow = this.auth.hasPermission('collections:write');
      if (canReviewNow === this.canReview) return;
      this.canReview = canReviewNow;
      this.reload();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.revokeComprobanteUrl();
  }

  // ── Carga de datos ────────────────────────────────────────────────────────────

  // `page` por default 1: cualquier cambio de filtro (pestaña, búsqueda, fecha)
  // vuelve a la primera página — mantener la página vieja de un filtro distinto
  // no tiene sentido y puede pedir un `skip` mayor que el total de resultados.
  reload(page: number = 1): void {
    this.loading   = true;
    this.loadError = null;
    const params: CollectionRequestListParams = {
      page,
      limit:       this.pagination.limit,
      status:      this.activeTab,
      search:      this.searchTerm  || undefined,
      fechaInicio: this.fechaInicio || undefined,
      fechaFin:    this.fechaFin    || undefined,
    };
    const fetch$ = this.canReview ? this.svc.list(params) : this.svc.listMine(params);
    fetch$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.solicitudes = res.data || [];
        this.pagination  = res.pagination;
        this.loading = false;
      },
      error: (err) => {
        this.loadError = err?.error?.error || 'No se pudieron cargar las solicitudes.';
        this.loading = false;
      },
    });
    this.reloadStats();
  }

  changePage(page: number): void {
    if (page < 1 || page > this.pagination.pages || page === this.pagination.page) return;
    this.reload(page);
  }

  // Conteos globales (no acotados a la pestaña/página actual) — ver comentario
  // en la declaración de statsData más arriba. best-effort: si falla, se quedan
  // los conteos de la última carga exitosa; no vale la pena bloquear la tabla
  // completa por esto.
  private reloadStats(): void {
    const stats$ = this.canReview ? this.svc.stats() : this.svc.statsMine();
    stats$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => this.statsData = res,
      error: () => {},
    });
  }

  onSearchChange(): void {
    this.search$.next(this.searchTerm);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.reload(1);
    // Sin este next(''), distinctUntilChanged() se queda con el ÚLTIMO término buscado como
    // "valor anterior" — si la siguiente búsqueda coincide exacto con esa, quedaría bloqueada
    // en silencio (mismo gap encontrado y corregido en el buscador global de Bancos).
    this.search$.next('');
  }

  /**
   * Arma (o re-arma) la suscripción del buscador de la bandeja. Mismo endurecimiento
   * aplicado hoy al buscador global de Bancos (banks.component.ts): esta suscripción solo
   * DISPARA `reload(1)` — no encadena la llamada HTTP con switchMap como Bancos, así que
   * `reload()` ya tiene su propio `error:` aislado y un fallo de red acá nunca la mataba. Se
   * blinda igual de todas formas, por consistencia y para cubrir cualquier error sincrónico
   * inesperado dentro del callback: si algo se escapa, se loguea a consola y se re-arma sola
   * en vez de quedar muda hasta recargar la página.
   */
  private _wireSearch(): void {
    this.search$.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe({
      next: () => {
        try {
          this.reload(1);
        } catch (err) {
          console.error('[CollectionRequestComponent] buscador: error sincrónico en reload()', err);
        }
      },
      error: (err) => {
        console.error('[CollectionRequestComponent] buscador: la suscripción murió, re-armando', err);
        this._wireSearch();
      },
    });
  }

  // Reporte Excel — solo solicitudes resueltas (Autorizadas/Rechazadas), nunca
  // pendientes, sin importar la pestaña activa (el botón vive en la barra de
  // filtros compartida). canReview ya distingue cobranza/contabilidad/admin
  // (bandeja completa) de tienda (solo lo propio) en el resto del componente —
  // mismo criterio aquí. Mismo patrón de descarga que exportExcel() en
  // banks.component.ts: blob → URL.createObjectURL → click en <a> temporal → revoke.
  descargarReporte(): void {
    if (this.generandoReporte) return;
    this.generandoReporte = true;
    const params = {
      search:      this.searchTerm  || undefined,
      fechaInicio: this.fechaInicio || undefined,
      fechaFin:    this.fechaFin    || undefined,
    };
    const fetch$ = this.canReview ? this.svc.report(params) : this.svc.reportMine(params);
    fetch$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const fecha = new Date().toISOString().slice(0, 10);
        a.href     = url;
        a.download = `${this.canReview ? 'Solicitudes-Cobro' : 'Mis-Solicitudes-Cobro'}-${fecha}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.generandoReporte = false;
      },
      error: () => {
        this.generandoReporte = false;
        this.toast.error('No se pudo generar el reporte.');
      },
    });
  }

  // ── Tabs y stats ────────────────────────────────────────────────────────────

  countByStatus(status: TabStatus): number {
    return this.statsData?.counts[status] ?? 0;
  }

  get identificadasHoyCount(): number {
    return this.statsData?.identificadasHoy ?? 0;
  }

  get rechazadasHoyCount(): number {
    return this.statsData?.rechazadasHoy ?? 0;
  }

  get montoPendienteTotal(): number {
    return this.statsData?.montoPendienteTotal ?? 0;
  }

  setTab(tab: TabStatus): void {
    this.activeTab = tab;
    this.reload(1);
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

  /** Suma de los importes por forma de pago — para el renglón "Total" del desglose en el modal de conciliación. */
  formasPagoTotal(s: CollectionRequest): number {
    return s.formasPago.reduce((acc, f) => acc + f.importe, 0);
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
    this.comprobanteZoomed    = false;
    this.showComprobanteModal = true;
    this._cargarComprobanteActual();
  }

  comprobanteAnterior(): void {
    if (this.comprobanteIndex <= 0) return;
    this.comprobanteIndex--;
    this.comprobanteZoomed = false;
    this._cargarComprobanteActual();
  }

  comprobanteSiguiente(): void {
    if (this.comprobanteIndex >= this.comprobanteTotal - 1) return;
    this.comprobanteIndex++;
    this.comprobanteZoomed = false;
    this._cargarComprobanteActual();
  }

  // Al acercar, centra el scroll en el punto donde se hizo clic — sin esto,
  // ampliar la imagen siempre deja visible la esquina superior izquierda,
  // sin importar qué parte del comprobante se quiso leer.
  toggleComprobanteZoom(event: MouseEvent): void {
    const img = event.target as HTMLImageElement;
    const zoomingIn = !this.comprobanteZoomed;
    if (zoomingIn) {
      const rect = img.getBoundingClientRect();
      this._comprobanteZoomFocus = {
        xFrac: (event.clientX - rect.left) / rect.width,
        yFrac: (event.clientY - rect.top) / rect.height,
      };
    }
    this.comprobanteZoomed = zoomingIn;
    if (zoomingIn) requestAnimationFrame(() => this._centrarZoomComprobante(img));
  }

  private _centrarZoomComprobante(img: HTMLImageElement): void {
    const container = img.parentElement;
    const focus = this._comprobanteZoomFocus;
    if (!container || !focus) return;
    // Se usa el tamaño YA renderizado (post-zoom), no naturalWidth/naturalHeight:
    // fotos de comprobante suelen traer rotación EXIF, y el tamaño que el
    // navegador muestra en pantalla no siempre coincide con naturalWidth/Height
    // en ese caso — leer el rect real evita ese desfase.
    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    const clickX = imgRect.left - containerRect.left + container.scrollLeft + focus.xFrac * imgRect.width;
    const clickY = imgRect.top  - containerRect.top  + container.scrollTop  + focus.yFrac * imgRect.height;
    container.scrollLeft = Math.max(0, clickX - container.clientWidth  / 2);
    container.scrollTop  = Math.max(0, clickY - container.clientHeight / 2);
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
    this.showFpDetail    = false;
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

    // Bug real 2026-07-31 (ver esMatchComprobante): la tolerancia era < 1 (casi un peso
    // completo) en las 3 comparaciones — un depósito a centavos de diferencia del monto
    // real contaba como "match exacto", agrupando montos genuinamente distintos como
    // "ambiguo". < 0.01 compara al centavo, con margen solo para el punto flotante de JS.
    if (Math.abs(deposito - bancario) < 0.01) return 'bancario';
    if (Math.abs(deposito - s.monto) < 0.01) return 'total';
    if (this.ocrResultados.some(r => r.extracted.monto != null && Math.abs(deposito - r.extracted.monto) < 0.01)) return 'ocr';
    return null;
  }

  private esMatchExacto(m: any, s: CollectionRequest): boolean {
    return this.matchKind(m, s) !== null;
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
    // Bug real 2026-07-31: la tolerancia era < 1 (casi un peso completo) — un depósito
    // a 61 centavos de diferencia del monto leído del comprobante contaba como "match
    // exacto" (caso real: comprobante $1,490.88 vs depósito $1,490.27), metiendo ambos
    // en el mismo grupo de "ambiguo" aunque solo uno fuera realmente el mismo importe.
    // < 0.01 compara al centavo — el único margen que queda es para el error de punto
    // flotante de JS (0.1+0.2 !== 0.3), nunca para tratar montos distintos como iguales.
    return Math.abs((m.deposito ?? 0) - monto) < 0.01;
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

  // Colapsa candidatos repetidos que apuntan al MISMO BankMovement (mismo
  // `_id`) — pasa cuando dos comprobantes distintos de la misma solicitud (ej.
  // una parte transferencia + otra cheque, con el mismo comprobante adjunto
  // para ambas) extraen exactamente el mismo monto/fecha y por lo tanto
  // sugieren el mismo depósito dos veces. Se conserva UNA fila por movimiento,
  // con el mejor score/nivel OCR entre los duplicados, y se juntan los índices
  // de TODOS los comprobantes que lo sugirieron en `_comprobanteIndices` (para
  // mostrar "comprobante #1, #2" en vez de una fila por cada uno). `_comprobanteIndex`
  // (singular) se conserva apuntando al de mejor score — esMatchComprobante()
  // sigue usándolo tal cual.
  private _dedupeBankMovements(movimientos: any[]): any[] {
    const porId = new Map<string, any>();
    for (const m of movimientos) {
      const existente = porId.get(m._id);
      if (!existente) {
        porId.set(m._id, { ...m, _comprobanteIndices: [m._comprobanteIndex] });
        continue;
      }
      existente._comprobanteIndices.push(m._comprobanteIndex);
      if ((m._ocrScore ?? -1) > (existente._ocrScore ?? -1)) {
        existente._ocrScore        = m._ocrScore;
        existente._ocrNivel        = m._ocrNivel;
        existente._ocrReasons      = m._ocrReasons;
        existente._comprobanteIndex = m._comprobanteIndex;
      }
    }
    return Array.from(porId.values());
  }

  // "1" o "1, 2" — usado por el badge de comprobante en el template.
  comprobanteIndicesLabel(m: any): string {
    const indices: number[] = m._comprobanteIndices ?? [m._comprobanteIndex];
    return indices.filter(i => i != null).map(i => i + 1).join(', ');
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
      // Bug real 2026-07-31: solo 'no_identificado' dejaba fuera cualquier movimiento
      // 'reclasificado' ("Por conciliar") — ese status es un overlay de categoría sobre el
      // estado NATURAL no_identificado (aplicarLogicaErp nunca lo devuelve por sí solo, ver
      // bank.service.js resolveCategoriaEffects), no significa que ya tenga una CxC vinculada.
      // 'otros' se deja afuera a propósito: ese overlay marca un depósito que NUNCA
      // corresponderá a una CxC (nómina, traspaso interno, etc.).
      status:      'no_identificado,reclasificado',
      limit:       100,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        // Bug real 2026-07-31: sinCxcAjena() excluía un depósito que ya tenía una CxC
        // de OTRA solicitud vinculada — contradice la decisión explícita del usuario
        // (2026-07-30, ver receipt.service.js#findMatchingMovements) de que un depósito
        // parcialmente cubierto SÍ debe seguir apareciendo como candidato para cualquier
        // solicitud mientras no esté 'identificado'. Se quitó, igual que allá.
        const fetched     = res.data || [];
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
      // Mismo fix que runAutoSearch() — 'reclasificado' ("Por conciliar") sigue sin CxC
      // vinculada, no debe excluirse de la búsqueda manual tampoco.
      status:      'no_identificado,reclasificado',
      // Bug real 2026-07-31: con 2 decimales tipeados la tolerancia por default es ±0.005
      // (prácticamente exacta al centavo) — el usuario pidió explícitamente un margen de
      // centavos reales para este buscador. 'amplia' usa el mismo criterio ya establecido
      // para el matching OCR de comprobantes (max($0.50, monto*0.5%)).
      montoTolerancia: 'amplia',
      limit:       100,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        // sinCxcAjena() se quitó acá también — ver comentario en runAutoSearch().
        this.bankMovements   = res.data || [];
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

  toggleFpDetail(): void {
    this.showFpDetail = !this.showFpDetail;
  }

  // Corre OCR + matching sobre CADA comprobante ya guardado en la solicitud (no
  // hace falta volver a subirlos). Reusa el mismo motor que OcrModalComponent
  // en Bancos (Gemini/Vision/Tesseract + scoring por monto/fecha). Cada
  // comprobante se analiza de forma INDEPENDIENTE — nunca se combinan sus
  // montos extraídos entre sí — pero sus candidatos SÍ se juntan en una sola
  // lista visible (cada fila queda etiquetada con `_comprobanteIndex`), porque
  // hoy una solicitud solo puede identificarse contra UN movimiento a la vez.
  // Caso real (2026-07-17): una solicitud con una parte en transferencia y otra
  // en cheque puede traer el MISMO comprobante adjunto para ambas formas de
  // pago — el OCR extrae exactamente lo mismo de los dos, así que ambos
  // sugieren el mismo BankMovement. Sin dedupe, eso salía como "2 candidatos"
  // y unicoCandidato() (que solo mira length) lo trataba como ambiguo aunque
  // fuera el mismo movimiento — ver _dedupeBankMovements.
  analizarComprobante(): void {
    if (!this.authTarget) return;
    const target = this.authTarget;
    this.ocrAnalyzing = true;
    this.authStage    = 'searching';

    this.svc.analyzeComprobante(target._id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (resultados) => {
        this.ocrAnalyzing  = false;
        this.ocrResultados = resultados;
        this.bankMovements = this._dedupeBankMovements(resultados.flatMap(r => r.candidates.map(c => ({
          ...c.movement, _ocrScore: c.score, _ocrNivel: c.nivel, _ocrReasons: c.reasons,
          _comprobanteIndex: r.comprobanteIndex,
        }))));
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

  // ── Selector de rango de fechas (calendario) ─────────────────────────────────
  // Puerto del calendario hand-rolled de banks.component.ts (openDatePicker/
  // buildCalDays/onCalClick/etc.) — mismo look&feel, SIN librería nueva. Esta
  // vista solo necesita UN rango de fechas (createdAt), a diferencia de Bancos
  // (3 contextos: filtro principal + 2 reportes), así que se simplifica quitando
  // el enum `calendarContext` y las ramas que dependían de él.
  readonly CAL_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  readonly CAL_DIAS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];

  @ViewChild('dateRangeBtn') dateRangeBtnRef!: ElementRef<HTMLElement>;

  showDatePicker = false;
  calPopupTop  = 0;
  calPopupLeft = 0;
  calYear  = new Date().getFullYear();
  calMonth = new Date().getMonth();
  calDaysArr: { iso: string; day: number; inMonth: boolean }[] = [];
  pickerStart: string | null = null;
  pickerEnd:   string | null = null;
  pickerHover: string | null = null;

  // Drag del popup por el encabezado — cheap de portar y evita que el popup
  // tape algo debajo si el usuario lo quiere mover, igual que en Bancos.
  private calDragging    = false;
  private calDragMovedPx = 0;
  private calDragOffX    = 0;
  private calDragOffY    = 0;

  get calMonthLabel(): string {
    return `${this.CAL_MESES[this.calMonth]} ${this.calYear}`;
  }

  get dateRangeLabel(): string {
    if (!this.fechaInicio && !this.fechaFin) return 'Rango de fechas';
    const fmt = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
    if (this.fechaInicio && this.fechaFin) return `${fmt(this.fechaInicio)} – ${fmt(this.fechaFin)}`;
    return this.fechaInicio ? `Desde ${fmt(this.fechaInicio)}` : `Hasta ${fmt(this.fechaFin)}`;
  }

  openDatePicker(event: Event, el?: HTMLElement): void {
    event.stopPropagation();
    // Posicionar el popup respecto al viewport del botón (position:fixed escapa
    // cualquier contenedor con overflow:hidden o overflow:auto) — mismo criterio
    // que banks.component.ts.
    const btn  = el ?? this.dateRangeBtnRef.nativeElement;
    const rect = btn.getBoundingClientRect();
    this.calPopupTop  = rect.bottom + 6;
    this.calPopupLeft = rect.left;

    if (this.fechaInicio) {
      const d = new Date(this.fechaInicio + 'T12:00:00');
      this.calYear  = d.getFullYear();
      this.calMonth = d.getMonth();
    } else {
      const now = new Date();
      this.calYear  = now.getFullYear();
      this.calMonth = now.getMonth();
    }
    this.pickerStart = this.fechaInicio || null;
    this.pickerEnd   = this.fechaFin   || null;
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
      this.fechaInicio = s;
      this.fechaFin    = e;
      this.showDatePicker = false;
      // A diferencia de Bancos (que dispara loadMovements vía valueChanges del
      // form con debounceTime(0)), acá no hay reactive form para las fechas —
      // se recarga directo, un solo lugar que las asigna ambas.
      this.reload(1);
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
    this.fechaInicio = '';
    this.fechaFin    = '';
    this.showDatePicker = false;
    this.reload(1);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    // Si el usuario arrastró el calendario, suprimir el click que dispara
    // mouseup→click justo al soltar — mismo criterio que banks.component.ts.
    if (this.calDragMovedPx > 4) { this.calDragMovedPx = 0; return; }
    this.showDatePicker = false;
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent): void {
    if (!this.calDragging) return;
    const newLeft = event.clientX - this.calDragOffX;
    const newTop  = event.clientY - this.calDragOffY;
    // Mantener el popup dentro del viewport.
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
}
