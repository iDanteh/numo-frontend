import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyAdjustmentReason, LoyaltySucursal,
  LoyaltyActualizarSucursalPayload,
  LoyaltyPromotion, LoyaltyKoreConcepto, LoyaltyKoreFormaPago, LoyaltyKoreNivel,
} from '../../../core/services/loyalty.service';
import { SocketService } from '../../../core/services/socket.service';
import { ConfigAuditLog } from '../../../core/models/config.model';

/** Entrada de historial ya resuelta para el panel. `claveLabel` quedó del bloque de % por nivel
 *  (REEMPLAZADO 2026-11-06 por "Niveles Kore", ver abajo — el % ya no lo configura Numo) — el tipo
 *  se mantiene opcional por si algún otro panel combinado lo necesita a futuro. */
export type LcHistoryEntry = ConfigAuditLog & { claveLabel?: string };

interface LcHistoryModalState {
  show:    boolean;
  titulo:  string;
  loading: boolean;
  error:   string;
  logs:    LcHistoryEntry[];
}

const EMPTY_HISTORY_MODAL: LcHistoryModalState = {
  show: false, titulo: '', loading: false, error: '', logs: [],
};

/** Entero distinto de 0, o null/vacío para modo manual (rediseño 2026-10-23) — mismo mensaje
 *  que el backend, para feedback instantáneo sin round-trip. Movido a nivel de módulo (2026-11-03,
 *  split de catálogo) — reusado por las dos instancias de ReasonCatalogoSeccion de abajo. */
const MENSAJE_PUNTOS_FIJOS_INVALIDO =
  'Puntos fijos debe ser un número entero distinto de 0 (o dejarse vacío para modo manual).';

function validarPuntosFijos(valor: number | null): string {
  if (valor == null) return '';
  return Number.isInteger(valor) && valor !== 0 ? '' : MENSAJE_PUNTOS_FIJOS_INVALIDO;
}

/**
 * Estado + CRUD de UNA sección del catálogo de motivos (split de catálogo, 2026-11-03, pedido
 * explícito del usuario): "Motivos de ajuste" y "Catálogo de bonificaciones" son dos secciones
 * separadas en la UI sobre el MISMO catálogo físico (`loyalty_adjustment_reasons`, ver
 * loyalty-config.service.js#listarReasons) — una instancia por `categoria`, fijada en el
 * constructor; el usuario nunca la elige en el formulario (la sección donde está parado la
 * determina). Clase aparte (en vez de duplicar 1:1 el bloque de estado/métodos que tenía esta
 * pantalla antes del split) para no triplicar la misma lógica de carga/crear/editar/activar.
 */
class ReasonCatalogoSeccion {
  list: LoyaltyAdjustmentReason[] = [];
  loading = false;
  error = '';
  showNuevo = false;
  nuevo: { clave: string; nombre: string; puntosFijos: number | null } = { clave: '', nombre: '', puntosFijos: null };
  saving = false;
  editingId: number | null = null;
  edit: { nombre: string; puntosFijos: number | null } = { nombre: '', puntosFijos: null };

  constructor(
    private readonly categoria: 'ajuste' | 'bonificacion',
    private readonly loyalty: LoyaltyService,
    private readonly destroy$: Subject<void>,
  ) {}

  cargar(): void {
    this.loading = true;
    this.loyalty.listarReasons({ categoria: this.categoria }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (r) => { this.list = r; this.loading = false; },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'No se pudo cargar el catálogo.';
      },
    });
  }

  abrirNuevo(): void {
    this.nuevo = { clave: '', nombre: '', puntosFijos: null };
    this.error = '';
    this.showNuevo = true;
  }

  cancelarNuevo(): void {
    this.showNuevo = false;
  }

  crear(): void {
    if (this.saving) return;
    const clave = this.nuevo.clave.trim();
    const nombre = this.nuevo.nombre.trim();
    if (!clave || !nombre) {
      this.error = 'Clave y nombre son obligatorios.';
      return;
    }
    const errorPuntos = validarPuntosFijos(this.nuevo.puntosFijos);
    if (errorPuntos) {
      this.error = errorPuntos;
      return;
    }
    this.error = '';
    this.saving = true;
    this.loyalty.crearReason({ clave, nombre, puntosFijos: this.nuevo.puntosFijos, categoria: this.categoria })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (r) => {
          this.list = [...this.list, r];
          this.saving = false;
          this.showNuevo = false;
        },
        error: (err) => {
          this.saving = false;
          this.error = err?.error?.error || 'No se pudo crear el motivo.';
        },
      });
  }

  iniciarEdicion(reason: LoyaltyAdjustmentReason): void {
    this.editingId = reason.id;
    this.edit = { nombre: reason.nombre, puntosFijos: reason.puntosFijos ?? null };
    this.error = '';
  }

  cancelarEdicion(): void {
    this.editingId = null;
  }

  guardarEdicion(reason: LoyaltyAdjustmentReason): void {
    if (this.saving) return;
    const nombre = this.edit.nombre.trim();
    if (!nombre) {
      this.error = 'El nombre es obligatorio.';
      return;
    }
    const errorPuntos = validarPuntosFijos(this.edit.puntosFijos);
    if (errorPuntos) {
      this.error = errorPuntos;
      return;
    }
    this.error = '';
    this.saving = true;
    this.loyalty.editarReason(reason.id, { nombre, puntosFijos: this.edit.puntosFijos })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (r) => {
          this.list = this.list.map(x => x.id === r.id ? r : x);
          this.saving = false;
          this.editingId = null;
        },
        error: (err) => {
          this.saving = false;
          this.error = err?.error?.error || 'No se pudo guardar el motivo.';
        },
      });
  }

  /** Activar/desactivar sin pasar por el formulario de edición — igual criterio que el toggle de
   *  "Activa" de una tarjeta (tarjeta-detail). */
  toggleActivo(reason: LoyaltyAdjustmentReason): void {
    if (this.saving) return;
    this.saving = true;
    this.loyalty.editarReason(reason.id, { activo: !reason.activo })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (r) => {
          this.list = this.list.map(x => x.id === r.id ? r : x);
          this.saving = false;
        },
        error: (err) => {
          this.saving = false;
          this.error = err?.error?.error || 'No se pudo actualizar el estatus del motivo.';
        },
      });
  }
}

/**
 * Configuración de Lealtad (loyalty:config, route guard ya aplicado en
 * lealtad-routing.module.ts) — reemplaza el placeholder de PR5. spec
 * loyalty-config:
 *  - Niveles Kore (2026-11-06, reemplaza el bloque de "% por nivel"): catálogo de solo lectura
 *    espejado de Kore (incluye el % de acumulación, autoritativo de Kore) — Numo solo puede marcar
 *    `esInicial` (qué nivel le toca a una tarjeta nueva).
 *  - Catálogo de motivos de ajuste: crear/editar/activar-desactivar. Un
 *    motivo desactivado deja de ofrecerse en nuevos AJUSTEs (ver
 *    movimiento-modal.component.ts#activeReasons) pero las entradas
 *    históricas conservan su reasonId intacto — nunca se borra un motivo.
 *  - Flags de sucursal: participaLealtad/permiteCanjeLealtad, cada uno
 *    editable de forma independiente.
 *  - Refresco en vivo: configUpdated$ filtrado a sectionClave==='lealtad',
 *    mismo criterio que movimiento-modal.component.ts/
 *    bank-corte-panel.component.ts:74-80.
 */
@Component({
  standalone: false,
  selector: 'app-lealtad-config',
  templateUrl: './lealtad-config.component.html',
  styleUrls: ['./lealtad-config.component.css'],
})
export class LealtadConfigComponent implements OnInit, OnDestroy {
  // ── Niveles Kore (2026-11-06, reemplaza el bloque de "% por nivel") ──
  // Kore pasa a gestionar el catálogo completo de niveles, INCLUYENDO el %
  // de acumulación — Numo ya no configura nada propio para esto. Mismo
  // espíritu que Conceptos Kore/Formas de pago Kore (tabla de solo lectura +
  // botón "Sincronizar con Kore"), con una sola diferencia: acá Numo puede
  // editar `esInicial` (qué nivel le toca a una tarjeta nueva).
  nivelesKore: LoyaltyKoreNivel[] = [];
  nivelesKoreLoading = false;
  nivelesKoreError = '';
  nivelesKoreSyncing = false;
  nivelesKoreSyncMensaje = '';
  nivelesKoreSavingId: number | null = null;

  // ── Congelamiento de puntos (2026-11-03) ──
  // Mismo criterio de UI que Foto de clientes abajo: un solo valor (CONGELAMIENTO_MESES), su
  // propio GET/PUT y botón "Ver historial" sobre el mecanismo genérico de ConfigAuditLog. Vacío/0
  // = deshabilitado — mismo criterio exacto que valida el backend (ver loyalty-config.service.js).
  congelamientoMeses: number | null = null;
  congelamientoLoading = false;
  congelamientoSaving = false;
  congelamientoError = '';

  // ── Límite mensual de consultas con código (2026-11-09) ──
  // Blindaje adicional sobre la consulta pública: mismo criterio de UI exacto que Congelamiento
  // arriba (vacío/0 = sin límite, mismo patrón GET/PUT + "Ver historial").
  consultaCodigoMaxMes: number | null = null;
  consultaCodigoMaxMesLoading = false;
  consultaCodigoMaxMesSaving = false;
  consultaCodigoMaxMesError = '';

  // ── Vigencia del código de autorización de canje con Kore (2026-11-13) ──
  // Mismo criterio de UI que Congelamiento/Límite de consultas arriba, pero acá 0/vacío NO es
  // válido (siempre hace falta una vigencia real) — ver _validarCanjeCodigoVigenciaMin en el
  // backend. Nunca null: el backend siempre devuelve un entero positivo (default 5).
  canjeCodigoVigenciaMin: number | null = null;
  canjeCodigoVigenciaLoading = false;
  canjeCodigoVigenciaSaving = false;
  canjeCodigoVigenciaError = '';

  // ── Catálogos (Especialidades, 2026-10-23) ──
  // Fusionado acá (en vez de Configuraciones Globales genérico) para que toda la config de
  // Lealtad viva en una sola pantalla — ver config-admin.component.ts, que filtra 'lealtad' del
  // riel genérico. Cada agregar/quitar manda la lista COMPLETA (mismo criterio que el editor de
  // chips de tipo:'lista' en Configuraciones Globales), no hay botón "Guardar" aparte.
  especialidades: string[] = [];
  especialidadesLoading = false;
  especialidadesSaving = false;
  especialidadesError = '';
  nuevaEspecialidad = '';

  // ── Foto de clientes (2026-10-29) ──
  // Folder ID de Drive consumido por drive-loyalty-foto.service.js#folderId() — sin esto el
  // admin no tiene forma de setear la clave (sección 'lealtad' oculta del riel genérico de
  // Configuraciones Globales, ver config-admin.component.ts). Puede guardarse vacío ("no
  // configurado"): el propio servicio de Drive rechaza explícito recién al intentar subir una foto.
  fotoFolderId = '';
  fotoFolderIdLoading = false;
  fotoFolderIdSaving = false;
  fotoFolderIdError = '';

  // ── Catálogo de motivos (split 2026-11-03, pedido explícito del usuario) ──
  // Dos secciones separadas sobre el mismo catálogo físico — ver ReasonCatalogoSeccion arriba.
  readonly motivosAjuste: ReasonCatalogoSeccion;
  readonly catalogoBonificaciones: ReasonCatalogoSeccion;

  // ── Promociones (ej. "Buen Fin") ──
  promociones: LoyaltyPromotion[] = [];
  promocionesLoading = false;
  promocionesError = '';
  showNuevaPromocion = false;
  nuevaPromocion: { nombre: string; fechaInicio: string; fechaFin: string; porcentajeBono: number | null } =
    { nombre: '', fechaInicio: '', fechaFin: '', porcentajeBono: null };
  promocionSaving = false;
  editingPromocionId: number | null = null;
  editPromocion: { nombre: string; fechaInicio: string; fechaFin: string; porcentajeBono: number | null } =
    { nombre: '', fechaInicio: '', fechaFin: '', porcentajeBono: null };

  // ── Sucursales ──
  sucursales: LoyaltySucursal[] = [];
  sucursalesLoading = false;
  sucursalesError = '';
  sucursalSavingId: number | null = null;
  // Flash de confirmación tras guardar un flag (2026-10-19) — el toggle ya
  // comunica el estado, pero no había ninguna confirmación de que el guardado
  // async terminó bien (la fila solo se re-renderizaba en silencio).
  sucursalGuardadoId: number | null = null;
  sucursalGuardadoCampo: 'participa' | 'canje' | null = null;
  private sucursalGuardadoTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Catálogos Kore configurables (2026-10-26) ──
  // `acumulaPuntos`/`esPuntos` son decisión manual de Numo — los hints (koreAcumulaPuntosHint/
  // koreEsPuntosHint) son solo referencia informativa de lo que Kore reporta, nunca autoritativa
  // (ver memoria architecture_lealtad_kore_webhook_acumulacion: el entorno test de Kore ya se vio
  // desincronizado de producción).
  conceptosKore: LoyaltyKoreConcepto[] = [];
  conceptosKoreLoading = false;
  conceptosKoreError = '';
  conceptosKoreSyncing = false;
  conceptosKoreSyncMensaje = '';
  conceptosKoreSavingId: number | null = null;

  formasPagoKore: LoyaltyKoreFormaPago[] = [];
  formasPagoKoreLoading = false;
  formasPagoKoreError = '';
  formasPagoKoreSyncing = false;
  formasPagoKoreSyncMensaje = '';
  formasPagoKoreSavingId: number | null = null;

  // ── Historial de config (2026-10-29) ──
  // Panel único reusado por los 3 botones "Ver historial" de esta pantalla (% por nivel,
  // Especialidades, Foto de clientes) — mismo criterio que auditModal en config-admin.component.ts,
  // un solo modal a la vez en toda la pantalla.
  historyModal: LcHistoryModalState = { ...EMPTY_HISTORY_MODAL };

  private destroy$ = new Subject<void>();

  constructor(private loyalty: LoyaltyService, private socket: SocketService) {
    this.motivosAjuste = new ReasonCatalogoSeccion('ajuste', loyalty, this.destroy$);
    this.catalogoBonificaciones = new ReasonCatalogoSeccion('bonificacion', loyalty, this.destroy$);
  }

  ngOnInit(): void {
    this.cargarCongelamiento();
    this.cargarConsultaCodigoMaxMes();
    this.cargarCanjeCodigoVigencia();
    this.cargarEspecialidades();
    this.cargarFotoFolderId();
    this.motivosAjuste.cargar();
    this.catalogoBonificaciones.cargar();
    this.cargarSucursales();
    this.cargarPromociones();
    this.cargarConceptosKore();
    this.cargarFormasPagoKore();
    this.cargarNivelesKore();

    // Si otra sesión cambia un % de Lealtad mientras esta pantalla está
    // abierta, refresca sin recargar — mismo patrón que movimiento-modal.
    // (el % por nivel ya no vive en GlobalConfig, ver cargarNivelesKore — este
    // evento hoy solo es relevante para Especialidades)
    this.socket.configUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ sectionClave }) => {
        if (sectionClave === 'lealtad') {
          this.cargarEspecialidades();
        }
      });

    // Notificación en vivo (2026-11-10, pedido explícito del usuario — "relevante para el
    // registro de acumulaciones manuales": el staff consulta esta tabla para saber qué % va a
    // aplicar). Broadcast GLOBAL (sin sala) del webhook de catálogo de niveles de Kore.
    this.socket.lealtadNivelesKoreActualizado$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.cargarNivelesKore());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.sucursalGuardadoTimeout) clearTimeout(this.sucursalGuardadoTimeout);
  }

  // ── Niveles Kore (2026-11-06) ────────────────────────────────────────────

  private cargarNivelesKore(): void {
    this.nivelesKoreLoading = true;
    this.loyalty.listarNivelesKore().pipe(takeUntil(this.destroy$)).subscribe({
      next: (n) => { this.nivelesKore = n; this.nivelesKoreLoading = false; },
      error: (err) => {
        this.nivelesKoreLoading = false;
        this.nivelesKoreError = err?.error?.error || 'No se pudo cargar el catálogo de niveles de Kore.';
      },
    });
  }

  sincronizarNivelesKore(): void {
    if (this.nivelesKoreSyncing) return;
    this.nivelesKoreError = '';
    this.nivelesKoreSyncMensaje = '';
    this.nivelesKoreSyncing = true;
    this.loyalty.sincronizarNivelesKore().pipe(takeUntil(this.destroy$)).subscribe({
      next: (r) => {
        this.nivelesKoreSyncing = false;
        this.nivelesKoreSyncMensaje =
          `Sincronizado: ${r.nuevos} nuevos, ${r.actualizados} actualizados, ${r.desactivados} desactivados.`;
        this.cargarNivelesKore();
      },
      error: (err) => {
        this.nivelesKoreSyncing = false;
        this.nivelesKoreError = err?.error?.error || 'No se pudo sincronizar con Kore.';
      },
    });
  }

  /** Único campo editable por Numo. Mismo criterio que marcarComoPuntos() en Formas de pago Kore:
   *  marcar un nivel como inicial desmarca automáticamente cualquier otro (invariante del backend),
   *  así que siempre se recarga la lista completa al resolver en vez de parchear solo la fila. */
  toggleEsInicial(nivel: LoyaltyKoreNivel): void {
    if (this.nivelesKoreSavingId != null || nivel.esInicial) return;
    this.nivelesKoreError = '';
    this.nivelesKoreSavingId = nivel.id;
    this.loyalty.actualizarNivelKore(nivel.id, true).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.nivelesKoreSavingId = null;
        this.cargarNivelesKore();
      },
      error: (err) => {
        this.nivelesKoreSavingId = null;
        this.nivelesKoreError = err?.error?.error || 'No se pudo actualizar el nivel inicial.';
      },
    });
  }

  // ── Congelamiento de puntos ──────────────────────────────────────────────

  private cargarCongelamiento(): void {
    this.congelamientoLoading = true;
    this.loyalty.obtenerCongelamiento().pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ meses }) => { this.congelamientoMeses = meses; this.congelamientoLoading = false; },
      error: (err) => {
        this.congelamientoLoading = false;
        this.congelamientoError = err?.error?.error || 'No se pudo cargar la configuración de congelamiento.';
      },
    });
  }

  guardarCongelamiento(): void {
    if (this.congelamientoSaving) return;
    const valor = this.congelamientoMeses;
    // Mismo mensaje y criterio que _validarCongelamientoMeses en el backend (null/vacío/0 =
    // deshabilitado; cualquier otro valor debe ser entero >= 0) — feedback instantáneo sin
    // round-trip, igual que validarPuntosFijos() arriba.
    if (valor != null && (!Number.isInteger(valor) || valor < 0)) {
      this.congelamientoError = 'Los meses de congelamiento deben ser un número entero positivo (o 0/vacío para deshabilitar).';
      return;
    }
    this.congelamientoError = '';
    this.congelamientoSaving = true;
    this.loyalty.guardarCongelamiento(valor).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ meses }) => { this.congelamientoMeses = meses; this.congelamientoSaving = false; },
      error: (err) => {
        this.congelamientoSaving = false;
        this.congelamientoError = err?.error?.error || 'No se pudo guardar la configuración de congelamiento.';
      },
    });
  }

  // ── Límite mensual de consultas con código ────────────────────────────────

  private cargarConsultaCodigoMaxMes(): void {
    this.consultaCodigoMaxMesLoading = true;
    this.loyalty.obtenerConsultaCodigoMaxMes().pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ max }) => { this.consultaCodigoMaxMes = max; this.consultaCodigoMaxMesLoading = false; },
      error: (err) => {
        this.consultaCodigoMaxMesLoading = false;
        this.consultaCodigoMaxMesError = err?.error?.error || 'No se pudo cargar la configuración de límite mensual.';
      },
    });
  }

  guardarConsultaCodigoMaxMes(): void {
    if (this.consultaCodigoMaxMesSaving) return;
    const valor = this.consultaCodigoMaxMes;
    // Mismo mensaje y criterio que _validarConsultaCodigoMaxMes en el backend.
    if (valor != null && (!Number.isInteger(valor) || valor < 0)) {
      this.consultaCodigoMaxMesError = 'El máximo de consultas con código por mes debe ser un número entero positivo (o 0/vacío para deshabilitar).';
      return;
    }
    this.consultaCodigoMaxMesError = '';
    this.consultaCodigoMaxMesSaving = true;
    this.loyalty.guardarConsultaCodigoMaxMes(valor).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ max }) => { this.consultaCodigoMaxMes = max; this.consultaCodigoMaxMesSaving = false; },
      error: (err) => {
        this.consultaCodigoMaxMesSaving = false;
        this.consultaCodigoMaxMesError = err?.error?.error || 'No se pudo guardar la configuración de límite mensual.';
      },
    });
  }

  // ── Vigencia del código de autorización de canje con Kore ─────────────────

  private cargarCanjeCodigoVigencia(): void {
    this.canjeCodigoVigenciaLoading = true;
    this.loyalty.obtenerCanjeCodigoVigenciaMin().pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ minutos }) => { this.canjeCodigoVigenciaMin = minutos; this.canjeCodigoVigenciaLoading = false; },
      error: (err) => {
        this.canjeCodigoVigenciaLoading = false;
        this.canjeCodigoVigenciaError = err?.error?.error || 'No se pudo cargar la vigencia del código de canje.';
      },
    });
  }

  guardarCanjeCodigoVigencia(): void {
    if (this.canjeCodigoVigenciaSaving) return;
    const valor = this.canjeCodigoVigenciaMin;
    // Mismo mensaje y criterio que _validarCanjeCodigoVigenciaMin en el backend — a diferencia de
    // Congelamiento/Límite de consultas, acá 0/vacío NO es un valor válido.
    if (!Number.isInteger(valor) || (valor as number) <= 0) {
      this.canjeCodigoVigenciaError = 'La vigencia del código de canje debe ser un número entero mayor a 0 (minutos).';
      return;
    }
    this.canjeCodigoVigenciaError = '';
    this.canjeCodigoVigenciaSaving = true;
    this.loyalty.guardarCanjeCodigoVigenciaMin(valor).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ minutos }) => { this.canjeCodigoVigenciaMin = minutos; this.canjeCodigoVigenciaSaving = false; },
      error: (err) => {
        this.canjeCodigoVigenciaSaving = false;
        this.canjeCodigoVigenciaError = err?.error?.error || 'No se pudo guardar la vigencia del código de canje.';
      },
    });
  }

  // ── Catálogos (Especialidades) ───────────────────────────────────────────

  private cargarEspecialidades(): void {
    this.especialidadesLoading = true;
    this.loyalty.obtenerEspecialidades().pipe(takeUntil(this.destroy$)).subscribe({
      next: (e) => { this.especialidades = e; this.especialidadesLoading = false; },
      error: (err) => {
        this.especialidadesLoading = false;
        this.especialidadesError = err?.error?.error || 'No se pudo cargar el catálogo de especialidades.';
      },
    });
  }

  private guardarEspecialidadesLista(lista: string[]): void {
    if (this.especialidadesSaving) return;
    this.especialidadesError = '';
    this.especialidadesSaving = true;
    const anterior = this.especialidades;
    this.loyalty.guardarEspecialidades(lista).pipe(takeUntil(this.destroy$)).subscribe({
      next: (e) => { this.especialidades = e; this.especialidadesSaving = false; },
      error: (err) => {
        this.especialidades = anterior; // la UI ya había mostrado el chip nuevo/quitado — revertir si el guardado falla
        this.especialidadesSaving = false;
        this.especialidadesError = err?.error?.error || 'No se pudo guardar el catálogo de especialidades.';
      },
    });
  }

  agregarEspecialidad(): void {
    const valor = this.nuevaEspecialidad.trim();
    if (!valor) return;
    this.nuevaEspecialidad = '';
    this.guardarEspecialidadesLista([...this.especialidades, valor]);
  }

  quitarEspecialidad(index: number): void {
    this.guardarEspecialidadesLista(this.especialidades.filter((_, i) => i !== index));
  }

  // ── Foto de clientes ─────────────────────────────────────────────────────

  private cargarFotoFolderId(): void {
    this.fotoFolderIdLoading = true;
    this.loyalty.obtenerFotoFolderId().pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ folderId }) => { this.fotoFolderId = folderId; this.fotoFolderIdLoading = false; },
      error: (err) => {
        this.fotoFolderIdLoading = false;
        this.fotoFolderIdError = err?.error?.error || 'No se pudo cargar la configuración de Drive.';
      },
    });
  }

  guardarFotoFolderId(): void {
    if (this.fotoFolderIdSaving) return;
    this.fotoFolderIdError = '';
    this.fotoFolderIdSaving = true;
    this.loyalty.guardarFotoFolderId(this.fotoFolderId.trim()).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ folderId }) => { this.fotoFolderId = folderId; this.fotoFolderIdSaving = false; },
      error: (err) => {
        this.fotoFolderIdSaving = false;
        this.fotoFolderIdError = err?.error?.error || 'No se pudo guardar la configuración de Drive.';
      },
    });
  }

  // ── Catálogo de motivos ──────────────────────────────────────────────────

  // Rediseño 2026-10-23 (reemplaza signoPermitido/porcentaje): describe el modo del motivo para
  // la tabla, en vez de mostrar el número crudo sin contexto. Compartido por las dos secciones
  // (ajuste/bonificacion) — no depende de categoria.
  modoLabel(reason: LoyaltyAdjustmentReason): string {
    return reason.puntosFijos == null
      ? 'Manual (se escribe el monto al aplicar)'
      : `Fijo: ${reason.puntosFijos > 0 ? '+' : ''}${reason.puntosFijos} puntos`;
  }

  // ── Sucursales ───────────────────────────────────────────────────────────

  private cargarSucursales(): void {
    this.sucursalesLoading = true;
    this.loyalty.listarSucursales().pipe(takeUntil(this.destroy$)).subscribe({
      next: (s) => { this.sucursales = s; this.sucursalesLoading = false; },
      error: (err) => {
        this.sucursalesLoading = false;
        this.sucursalesError = err?.error?.error || 'No se pudieron cargar las sucursales.';
      },
    });
  }

  /** spec loyalty-config "Flags are set independently" — cada bandera manda
   *  SU PROPIO payload, nunca ambas juntas, para no pisar la otra con el
   *  valor que tenía en memoria si llegara a estar desactualizado. */
  toggleParticipa(sucursal: LoyaltySucursal): void {
    this.cambiarFlagSucursal(sucursal, { participaLealtad: !sucursal.participaLealtad }, 'participa');
  }

  togglePermiteCanje(sucursal: LoyaltySucursal): void {
    this.cambiarFlagSucursal(sucursal, { permiteCanjeLealtad: !sucursal.permiteCanjeLealtad }, 'canje');
  }

  private cambiarFlagSucursal(
    sucursal: LoyaltySucursal,
    payload: LoyaltyActualizarSucursalPayload,
    campo: 'participa' | 'canje',
  ): void {
    if (this.sucursalSavingId != null) return;
    this.sucursalesError = '';
    this.sucursalSavingId = sucursal.id;
    this.loyalty.actualizarSucursal(sucursal.id, payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: (s) => {
        this.sucursales = this.sucursales.map(x => x.id === s.id ? s : x);
        this.sucursalSavingId = null;
        this.mostrarGuardado(sucursal.id, campo);
      },
      error: (err) => {
        this.sucursalSavingId = null;
        this.sucursalesError = err?.error?.error || 'No se pudo actualizar la sucursal.';
      },
    });
  }

  private mostrarGuardado(id: number, campo: 'participa' | 'canje'): void {
    this.sucursalGuardadoId = id;
    this.sucursalGuardadoCampo = campo;
    if (this.sucursalGuardadoTimeout) clearTimeout(this.sucursalGuardadoTimeout);
    this.sucursalGuardadoTimeout = setTimeout(() => {
      this.sucursalGuardadoId = null;
      this.sucursalGuardadoCampo = null;
    }, 1200);
  }

  // ── Promociones (ej. "Buen Fin") ────────────────────────────────────────

  private cargarPromociones(): void {
    this.promocionesLoading = true;
    // Administración: traer todas, activas e inactivas (mismo criterio que
    // listarReasons() en esta pantalla, sin filtro de "solo activas").
    this.loyalty.listarPromociones().pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => { this.promociones = p; this.promocionesLoading = false; },
      error: (err) => {
        this.promocionesLoading = false;
        this.promocionesError = err?.error?.error || 'No se pudo cargar el catálogo de promociones.';
      },
    });
  }

  abrirNuevaPromocion(): void {
    this.nuevaPromocion = { nombre: '', fechaInicio: '', fechaFin: '', porcentajeBono: null };
    this.promocionesError = '';
    this.showNuevaPromocion = true;
  }

  cancelarNuevaPromocion(): void {
    this.showNuevaPromocion = false;
  }

  /** Comparación directa de string ISO 'YYYY-MM-DD' (no hace falta Date) y % en (0,100]. */
  private validarPromocion(p: { nombre: string; fechaInicio: string; fechaFin: string; porcentajeBono: number | null }): string {
    if (!p.nombre.trim()) return 'El nombre es obligatorio.';
    if (!p.fechaInicio || !p.fechaFin) return 'Captura fecha de inicio y fecha de fin.';
    if (p.fechaFin < p.fechaInicio) return 'La fecha de fin no puede ser anterior a la fecha de inicio.';
    const pct = p.porcentajeBono;
    if (pct == null || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return 'El % de bono debe ser mayor a 0 y menor o igual a 100.';
    }
    return '';
  }

  crearPromocion(): void {
    if (this.promocionSaving) return;
    const error = this.validarPromocion(this.nuevaPromocion);
    if (error) {
      this.promocionesError = error;
      return;
    }
    this.promocionesError = '';
    this.promocionSaving = true;
    this.loyalty.crearPromocion({
      nombre: this.nuevaPromocion.nombre.trim(),
      fechaInicio: this.nuevaPromocion.fechaInicio,
      fechaFin: this.nuevaPromocion.fechaFin,
      porcentajeBono: this.nuevaPromocion.porcentajeBono as number,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.promociones = [...this.promociones, p];
        this.promocionSaving = false;
        this.showNuevaPromocion = false;
      },
      error: (err) => {
        this.promocionSaving = false;
        this.promocionesError = err?.error?.error || 'No se pudo crear la promoción.';
      },
    });
  }

  iniciarEdicionPromocion(promo: LoyaltyPromotion): void {
    this.editingPromocionId = promo.id;
    this.editPromocion = {
      nombre: promo.nombre, fechaInicio: promo.fechaInicio, fechaFin: promo.fechaFin,
      porcentajeBono: promo.porcentajeBono,
    };
    this.promocionesError = '';
  }

  cancelarEdicionPromocion(): void {
    this.editingPromocionId = null;
  }

  guardarEdicionPromocion(promo: LoyaltyPromotion): void {
    if (this.promocionSaving) return;
    const error = this.validarPromocion(this.editPromocion);
    if (error) {
      this.promocionesError = error;
      return;
    }
    this.promocionesError = '';
    this.promocionSaving = true;
    this.loyalty.editarPromocion(promo.id, {
      nombre: this.editPromocion.nombre.trim(),
      fechaInicio: this.editPromocion.fechaInicio,
      fechaFin: this.editPromocion.fechaFin,
      porcentajeBono: this.editPromocion.porcentajeBono as number,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.promociones = this.promociones.map(x => x.id === p.id ? p : x);
        this.promocionSaving = false;
        this.editingPromocionId = null;
      },
      error: (err) => {
        this.promocionSaving = false;
        this.promocionesError = err?.error?.error || 'No se pudo guardar la promoción.';
      },
    });
  }

  toggleActivaPromocion(promo: LoyaltyPromotion): void {
    if (this.promocionSaving) return;
    this.promocionesError = '';
    this.promocionSaving = true;
    this.loyalty.editarPromocion(promo.id, { activa: !promo.activa }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.promociones = this.promociones.map(x => x.id === p.id ? p : x);
        this.promocionSaving = false;
      },
      error: (err) => {
        this.promocionSaving = false;
        this.promocionesError = err?.error?.error || 'No se pudo actualizar el estatus de la promoción.';
      },
    });
  }

  // ── Catálogo de Conceptos Kore (tipos de venta) ─────────────────────────

  private cargarConceptosKore(): void {
    this.conceptosKoreLoading = true;
    this.loyalty.listarConceptosKore().pipe(takeUntil(this.destroy$)).subscribe({
      next: (c) => { this.conceptosKore = c; this.conceptosKoreLoading = false; },
      error: (err) => {
        this.conceptosKoreLoading = false;
        this.conceptosKoreError = err?.error?.error || 'No se pudo cargar el catálogo de conceptos de Kore.';
      },
    });
  }

  sincronizarConceptosKore(): void {
    if (this.conceptosKoreSyncing) return;
    this.conceptosKoreError = '';
    this.conceptosKoreSyncMensaje = '';
    this.conceptosKoreSyncing = true;
    this.loyalty.sincronizarConceptosKore().pipe(takeUntil(this.destroy$)).subscribe({
      next: (r) => {
        this.conceptosKoreSyncing = false;
        this.conceptosKoreSyncMensaje =
          `Sincronizado: ${r.nuevos} nuevos, ${r.actualizados} actualizados, ${r.desactivados} desactivados.`;
        this.cargarConceptosKore();
      },
      error: (err) => {
        this.conceptosKoreSyncing = false;
        this.conceptosKoreError = err?.error?.error || 'No se pudo sincronizar con Kore.';
      },
    });
  }

  toggleAcumulaConcepto(concepto: LoyaltyKoreConcepto): void {
    if (this.conceptosKoreSavingId != null) return;
    this.conceptosKoreError = '';
    this.conceptosKoreSavingId = concepto.id;
    this.loyalty.actualizarConceptoKore(concepto.id, !concepto.acumulaPuntos)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (c) => {
          this.conceptosKore = this.conceptosKore.map(x => x.id === c.id ? c : x);
          this.conceptosKoreSavingId = null;
        },
        error: (err) => {
          this.conceptosKoreSavingId = null;
          this.conceptosKoreError = err?.error?.error || 'No se pudo actualizar el concepto.';
        },
      });
  }

  // ── Catálogo de Formas de pago Kore ──────────────────────────────────────

  private cargarFormasPagoKore(): void {
    this.formasPagoKoreLoading = true;
    this.loyalty.listarFormasPagoKore().pipe(takeUntil(this.destroy$)).subscribe({
      next: (f) => { this.formasPagoKore = f; this.formasPagoKoreLoading = false; },
      error: (err) => {
        this.formasPagoKoreLoading = false;
        this.formasPagoKoreError = err?.error?.error || 'No se pudo cargar el catálogo de formas de pago de Kore.';
      },
    });
  }

  sincronizarFormasPagoKore(): void {
    if (this.formasPagoKoreSyncing) return;
    this.formasPagoKoreError = '';
    this.formasPagoKoreSyncMensaje = '';
    this.formasPagoKoreSyncing = true;
    this.loyalty.sincronizarFormasPagoKore().pipe(takeUntil(this.destroy$)).subscribe({
      next: (r) => {
        this.formasPagoKoreSyncing = false;
        this.formasPagoKoreSyncMensaje =
          `Sincronizado: ${r.nuevos} nuevos, ${r.actualizados} actualizados, ${r.desactivados} desactivados.`;
        this.cargarFormasPagoKore();
      },
      error: (err) => {
        this.formasPagoKoreSyncing = false;
        this.formasPagoKoreError = err?.error?.error || 'No se pudo sincronizar con Kore.';
      },
    });
  }

  toggleAcumulaFormaPago(forma: LoyaltyKoreFormaPago): void {
    if (this.formasPagoKoreSavingId != null) return;
    this.formasPagoKoreError = '';
    this.formasPagoKoreSavingId = forma.id;
    this.loyalty.actualizarFormaPagoKore(forma.id, { acumulaPuntos: !forma.acumulaPuntos })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (f) => {
          this.formasPagoKore = this.formasPagoKore.map(x => x.id === f.id ? f : x);
          this.formasPagoKoreSavingId = null;
        },
        error: (err) => {
          this.formasPagoKoreSavingId = null;
          this.formasPagoKoreError = err?.error?.error || 'No se pudo actualizar la forma de pago.';
        },
      });
  }

  /** Marcar una forma de pago como "Puntos" desmarca automáticamente cualquier otra que lo fuera
   *  (invariante del backend) — por eso, a diferencia de toggleAcumulaFormaPago(), siempre se
   *  recarga la lista COMPLETA al resolver en vez de parchear solo la fila editada: otra fila
   *  (no la tocada acá) puede haber cambiado también. Confirmación nativa previa: un solo tap no
   *  debería poder desmarcar silenciosamente la forma de pago "Puntos" vigente. */
  marcarComoPuntos(forma: LoyaltyKoreFormaPago): void {
    if (this.formasPagoKoreSavingId != null || forma.esPuntos) return;
    if (!confirm(`¿Marcar "${forma.nombre}" como la forma de pago "Puntos"? Esto reemplaza a la que esté marcada hoy.`)) {
      return;
    }
    this.formasPagoKoreError = '';
    this.formasPagoKoreSavingId = forma.id;
    this.loyalty.actualizarFormaPagoKore(forma.id, { esPuntos: true })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.formasPagoKoreSavingId = null;
          this.cargarFormasPagoKore();
        },
        error: (err) => {
          this.formasPagoKoreSavingId = null;
          this.formasPagoKoreError = err?.error?.error || 'No se pudo marcar la forma de pago como "Puntos".';
        },
      });
  }

  // ── Historial de config (2026-10-29) ────────────────────────────────────
  // Mismo patrón visual/funcional que abrirHistorial() en config-admin.component.ts
  // (ConfigAuditLog YA se escribe en cada setValue() del backend) — acá vía
  // loyalty.service.ts#obtenerHistorialConfig (loyalty:config), nunca
  // ConfigService.listAuditLog (config:manage, pantalla genérica).

  /** Especialidades / Foto de clientes: una sola clave por panel. */
  abrirHistorialClave(clave: string, titulo: string): void {
    this.historyModal = { ...EMPTY_HISTORY_MODAL, show: true, titulo, loading: true };
    this.loyalty.obtenerHistorialConfig(clave).pipe(takeUntil(this.destroy$)).subscribe({
      next: (logs) => { this.historyModal = { ...this.historyModal, logs, loading: false }; },
      error: (err) => {
        this.historyModal = {
          ...this.historyModal, loading: false,
          error: err?.error?.error || 'No se pudo cargar el historial.',
        };
      },
    });
  }

  cerrarHistorial(): void {
    this.historyModal = { ...EMPTY_HISTORY_MODAL };
  }

  accionLabel(accion: ConfigAuditLog['accion']): string {
    switch (accion) {
      case 'creado':           return 'Creado';
      case 'editado':          return 'Editado';
      case 'secreto_revelado': return 'Secreto revelado';
      default:                 return accion;
    }
  }
}
