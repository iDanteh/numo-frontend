import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  LoyaltyCardListFilter, LoyaltyCardListResult, LoyaltyCard,
  LoyaltyCrearTarjetaPayload, LoyaltyCrearTarjetaResult, LoyaltyEditarTarjetaPayload,
  LoyaltyCambiarNipResult, LoyaltyMovimientoListResult, LoyaltyTierHistoryEntry,
  LoyaltyAcumulacionPayload, LoyaltyCanjePayload, LoyaltyAjustePayload, LoyaltyMovimientoResult,
  LoyaltyPorcentajes, LoyaltyAdjustmentReason, LoyaltySucursal,
  LoyaltyGuardarPorcentajesPayload, LoyaltyCrearReasonPayload, LoyaltyEditarReasonPayload,
  LoyaltyPromotion, LoyaltyCrearPromocionPayload, LoyaltyEditarPromocionPayload,
  LoyaltyActualizarSucursalPayload, LoyaltyConsultaPublicaResult, LoyaltyImportConcentrado,
  LoyaltyImportClasificacion, LoyaltyImportAplicarJobIniciado, LoyaltyImportCorreccionClasificacion,
  LoyaltyPendingEnrollmentListResult, LoyaltyCompletarPendienteResult, LoyaltyPendingEnrollment,
  LoyaltySolicitarCodigoResult, LoyaltyConfirmarCodigoResult, LoyaltyKoreMatchJobIniciado,
  LoyaltyKoreMatchJobEstado,
} from '../models/loyalty.model';

export * from '../models/loyalty.model';

/**
 * Cliente HTTP del módulo Lealtad — mismo criterio que BankService: delega el
 * armado de query params/base URL a ApiService. Rutas y permisos per
 * design.md "Routes and Permissions" (`/api/loyalty/*`, staff-only —
 * `/loyalty/public/*` vive fuera de este servicio, consumido directo por
 * LealtadConsultaComponent sin passar por AuthHttpInterceptor, D13).
 */
@Injectable({ providedIn: 'root' })
export class LoyaltyService {
  // Catálogo de sucursales: rara vez cambia durante una sesión del navegador
  // y movimiento-modal.component.ts lo pide de nuevo cada vez que se abre
  // (el modal se monta/destruye con *ngIf) — shareReplay(1) evita un GET
  // nuevo a /loyalty/sucursales en cada apertura. Se invalida en
  // actualizarSucursal() para no servir datos obsoletos tras una edición.
  private sucursales$?: Observable<LoyaltySucursal[]>;

  constructor(private api: ApiService) {}

  listar(filter: LoyaltyCardListFilter = {}): Observable<LoyaltyCardListResult> {
    const params: Record<string, unknown> = {};
    if (filter.search)        params['search'] = filter.search;
    if (filter.nivel)         params['nivel']  = filter.nivel;
    if (filter.activa !== undefined && filter.activa !== '') params['activa'] = filter.activa;
    if (filter.page != null)  params['page']  = filter.page;
    if (filter.limit != null) params['limit'] = filter.limit;
    if (filter.sort)          params['sort']  = filter.sort;
    if (filter.sortDir)       params['sortDir'] = filter.sortDir;
    return this.api.get<LoyaltyCardListResult>('/loyalty/cards', params);
  }

  crearTarjeta(payload: LoyaltyCrearTarjetaPayload): Observable<LoyaltyCrearTarjetaResult> {
    return this.api.post<LoyaltyCrearTarjetaResult>('/loyalty/cards', payload);
  }

  obtener(id: number): Observable<LoyaltyCard> {
    return this.api.get<LoyaltyCard>(`/loyalty/cards/${id}`);
  }

  // Trae los campos de "Datos adicionales" (apodo/dirección/etc.) para precargar el formulario de
  // edición — `obtener()`/GET /cards normal los excluye por defaultScope (PII, ver
  // LoyaltyCard.js), gateado por loyalty:tarjetas:editar en vez de loyalty:read (2026-10-23).
  obtenerParaEditar(id: number): Observable<LoyaltyCard> {
    return this.api.get<LoyaltyCard>(`/loyalty/cards/${id}/editar`);
  }

  editarTarjeta(id: number, payload: LoyaltyEditarTarjetaPayload): Observable<LoyaltyCard> {
    return this.api.patch<LoyaltyCard>(`/loyalty/cards/${id}`, payload);
  }

  cambiarNip(id: number): Observable<LoyaltyCambiarNipResult> {
    return this.api.post<LoyaltyCambiarNipResult>(`/loyalty/cards/${id}/nip`, {});
  }

  cambiarNivel(id: number, nivel: string, motivo?: string): Observable<LoyaltyCard> {
    return this.api.put<LoyaltyCard>(`/loyalty/cards/${id}/nivel`, { nivel, motivo });
  }

  listarMovimientos(id: number, page = 1, limit = 20): Observable<LoyaltyMovimientoListResult> {
    return this.api.get<LoyaltyMovimientoListResult>(`/loyalty/cards/${id}/movimientos`, { page, limit });
  }

  listarNiveles(id: number): Observable<LoyaltyTierHistoryEntry[]> {
    return this.api.get<LoyaltyTierHistoryEntry[]>(`/loyalty/cards/${id}/niveles`);
  }

  registrarAcumulacion(id: number, payload: LoyaltyAcumulacionPayload): Observable<LoyaltyMovimientoResult> {
    return this.api.post<LoyaltyMovimientoResult>(`/loyalty/cards/${id}/acumulaciones`, payload);
  }

  registrarCanje(id: number, payload: LoyaltyCanjePayload): Observable<LoyaltyMovimientoResult> {
    return this.api.post<LoyaltyMovimientoResult>(`/loyalty/cards/${id}/canjes`, payload);
  }

  registrarAjuste(id: number, payload: LoyaltyAjustePayload): Observable<LoyaltyMovimientoResult> {
    return this.api.post<LoyaltyMovimientoResult>(`/loyalty/cards/${id}/ajustes`, payload);
  }

  // Lectura de la config vigente — la edición (PUT /config/porcentajes, loyalty:config)
  // llega en PR7. Se necesita acá para el preview en vivo de puntos del
  // movimiento-modal (D11: sin % configurado, el backend rechaza con 422).
  obtenerPorcentajes(): Observable<LoyaltyPorcentajes> {
    return this.api.get<LoyaltyPorcentajes>('/loyalty/config');
  }

  listarReasons(): Observable<LoyaltyAdjustmentReason[]> {
    return this.api.get<LoyaltyAdjustmentReason[]>('/loyalty/reasons');
  }

  // Lectura de sucursales con sus flags participaLealtad/permiteCanjeLealtad —
  // alimenta el combo de centro de costo del movimiento-modal.
  listarSucursales(): Observable<LoyaltySucursal[]> {
    if (!this.sucursales$) {
      this.sucursales$ = this.api.get<LoyaltySucursal[]>('/loyalty/sucursales').pipe(shareReplay(1));
    }
    return this.sucursales$;
  }

  // ── PR7: Config UI (loyalty:config) ───────────────────────────────────────

  guardarPorcentajes(payload: LoyaltyGuardarPorcentajesPayload): Observable<LoyaltyPorcentajes> {
    return this.api.put<LoyaltyPorcentajes>('/loyalty/config/porcentajes', payload);
  }

  // Especialidades (2026-10-23) — catálogo de referencia, fusionado en el panel de Lealtad
  // (ver lealtad-config.component.ts) en vez de Configuraciones Globales genérico.
  obtenerEspecialidades(): Observable<string[]> {
    return this.api.get<string[]>('/loyalty/config/especialidades');
  }

  guardarEspecialidades(especialidades: string[]): Observable<string[]> {
    return this.api.put<string[]>('/loyalty/config/especialidades', { especialidades });
  }

  crearReason(payload: LoyaltyCrearReasonPayload): Observable<LoyaltyAdjustmentReason> {
    return this.api.post<LoyaltyAdjustmentReason>('/loyalty/reasons', payload);
  }

  editarReason(id: number, payload: LoyaltyEditarReasonPayload): Observable<LoyaltyAdjustmentReason> {
    return this.api.patch<LoyaltyAdjustmentReason>(`/loyalty/reasons/${id}`, payload);
  }

  // ── Catálogo de Promociones (ej. "Buen Fin", loyalty:config) ──────────────

  listarPromociones(soloActivas?: boolean): Observable<LoyaltyPromotion[]> {
    return this.api.get<LoyaltyPromotion[]>(
      '/loyalty/promociones',
      soloActivas !== undefined ? { soloActivas } : undefined,
    );
  }

  crearPromocion(payload: LoyaltyCrearPromocionPayload): Observable<LoyaltyPromotion> {
    return this.api.post<LoyaltyPromotion>('/loyalty/promociones', payload);
  }

  editarPromocion(id: number, payload: LoyaltyEditarPromocionPayload): Observable<LoyaltyPromotion> {
    return this.api.patch<LoyaltyPromotion>(`/loyalty/promociones/${id}`, payload);
  }

  actualizarSucursal(id: number, payload: LoyaltyActualizarSucursalPayload): Observable<LoyaltySucursal> {
    // Invalida el caché de listarSucursales() — de lo contrario, tras editar
    // una bandera acá, otra pantalla (ej. movimiento-modal) seguiría viendo
    // el catálogo desactualizado durante el resto de la sesión.
    this.sucursales$ = undefined;
    return this.api.patch<LoyaltySucursal>(`/loyalty/sucursales/${id}`, payload);
  }

  // Consulta pública (D13: '/loyalty/public/' está excluido del uriMatcher de
  // AuthHttpInterceptor en app.module.ts — esta llamada sale sin Bearer, haya
  // o no sesión iniciada). Nunca se cachea: '/loyalty/' está en
  // NO_CACHE_PATTERNS (http-cache.interceptor.ts, PR5).
  consultaPublica(telefono: string, nip: string): Observable<LoyaltyConsultaPublicaResult> {
    return this.api.post<LoyaltyConsultaPublicaResult>('/loyalty/public/consulta', { telefono, nip });
  }

  // Recuperación de NIP en 2 pasos (mismo criterio D13 que consultaPublica:
  // sin Bearer, nunca se cachea). Paso 1: solicita un código de verificación
  // — la respuesta es siempre genérica (anti-enumeración), más `codigoDev`
  // fuera de producción mientras no haya un proveedor de mensajería real.
  solicitarCodigoRecuperacion(telefono: string): Observable<LoyaltySolicitarCodigoResult> {
    return this.api.post<LoyaltySolicitarCodigoResult>('/loyalty/public/recuperacion/solicitar', { telefono });
  }

  // Paso 2: confirma el código y recibe el NIP nuevo (el cliente nunca elige
  // su propio NIP, mismo criterio que crearTarjeta/cambiarNip de staff).
  confirmarCodigoRecuperacion(telefono: string, codigo: string): Observable<LoyaltyConfirmarCodigoResult> {
    return this.api.post<LoyaltyConfirmarCodigoResult>('/loyalty/public/recuperacion/confirmar', { telefono, codigo });
  }

  // ── Migración de clientes legados (loyalty:importar, admin-only) ────────
  // Ambos archivos son opcionales e independientes entre sí (al menos uno debe venir,
  // lo valida el backend). FormData con dos campos distintos ('clientes'/'puntos') en
  // una sola request — ApiService.post() no fuerza Content-Type JSON cuando el body es
  // un FormData, el navegador arma el multipart/form-data con el boundary correcto.
  generarConcentrado(clientes: File | null, puntos: File | null): Observable<LoyaltyImportConcentrado> {
    const formData = new FormData();
    if (clientes) formData.append('clientes', clientes);
    if (puntos) formData.append('puntos', puntos);
    return this.api.post<LoyaltyImportConcentrado>('/loyalty/import/concentrado', formData);
  }

  // Dry-run: clasifica contra la DB real (loyalty-import-apply.service#clasificar)
  // sin escribir nada — mismo endpoint que aplicarImportacion(), sin ?confirmar=true.
  clasificarImportacion(clientes: File | null, puntos: File | null): Observable<LoyaltyImportClasificacion> {
    const formData = new FormData();
    if (clientes) formData.append('clientes', clientes);
    if (puntos) formData.append('puntos', puntos);
    return this.api.post<LoyaltyImportClasificacion>('/loyalty/import/aplicar', formData);
  }

  // Aplica de verdad: crea tarjetas/movimientos MIGRACION/pendientes en lotes de 200 filas
  // (cada lote su propia transacción). Aborta con 422 (sin escrituras) si queda alguna fila
  // bloqueante — el admin debe correr clasificarImportacion() primero. Desde 2026-10-19 este
  // endpoint ya NO devuelve el resultado final directo (migrar ~9,633 filas tarda ~22min,
  // no cabe en una request) — responde de inmediato con el jobId y el progreso/resultado
  // final llegan por socket (lealtadApplyProgress$/Done$/Error$ en socket.service.ts).
  aplicarImportacion(clientes: File | null, puntos: File | null): Observable<LoyaltyImportAplicarJobIniciado> {
    const formData = new FormData();
    if (clientes) formData.append('clientes', clientes);
    if (puntos) formData.append('puntos', puntos);
    return this.api.post<LoyaltyImportAplicarJobIniciado>('/loyalty/import/aplicar?confirmar=true', formData);
  }

  // ── Correcciones (re-subida del Excel de filas bloqueantes corregidas a mano, 2026-10-19) ──
  // Flujo independiente del par clientes.csv/puntos.pdf — un único campo 'correcciones' (.xlsx).
  // Mismo contrato dry-run/confirmar que generarConcentrado/clasificarImportacion/aplicarImportacion.
  clasificarCorrecciones(file: File): Observable<LoyaltyImportCorreccionClasificacion> {
    const formData = new FormData();
    formData.append('correcciones', file);
    return this.api.post<LoyaltyImportCorreccionClasificacion>('/loyalty/import/correcciones', formData);
  }

  // Aplica de verdad: misma máquina de job en background (lotes de 200, progreso/resultado por
  // socket) que aplicarImportacion() — ver iniciarAplicarCorreccionesJob en el backend.
  aplicarCorrecciones(file: File): Observable<LoyaltyImportAplicarJobIniciado> {
    const formData = new FormData();
    formData.append('correcciones', file);
    return this.api.post<LoyaltyImportAplicarJobIniciado>('/loyalty/import/correcciones?confirmar=true', formData);
  }

  // ── Clientes pendientes (sin teléfono, decisión de negocio 2026-10-19) ──────

  listarPendientes(page = 1, limit = 50): Observable<LoyaltyPendingEnrollmentListResult> {
    return this.api.get<LoyaltyPendingEnrollmentListResult>('/loyalty/import/pendientes', { page, limit });
  }

  /** Trae TODOS los grupos pendientes de una sola vez (sin paginar), para exportar a Excel. */
  exportarPendientes(): Observable<LoyaltyPendingEnrollmentListResult> {
    return this.api.get<LoyaltyPendingEnrollmentListResult>('/loyalty/import/pendientes', { exportar: true });
  }

  completarPendiente(id: number, telefono: string): Observable<LoyaltyCompletarPendienteResult> {
    return this.api.post<LoyaltyCompletarPendienteResult>(`/loyalty/import/pendientes/${id}/completar`, { telefono });
  }

  /** Decisión de negocio 2026-10-19: el admin puede decidir que un cliente legado sin teléfono
   *  ya no se va a migrar. Nunca borra la fila — solo cambia su estado. */
  rechazarPendiente(id: number): Observable<LoyaltyPendingEnrollment> {
    return this.api.post<LoyaltyPendingEnrollment>(`/loyalty/import/pendientes/${id}/rechazar`, {});
  }

  /** Un solo UPDATE masivo en el backend — sin bcrypt/NIP de por medio, no hace falta job. */
  rechazarTodosPendientes(): Observable<{ rechazados: number }> {
    return this.api.post<{ rechazados: number }>('/loyalty/import/pendientes/rechazar-todos', {});
  }

  // ── Match de clientes contra Kore (loyalty:importar, 2026-10-22) ────────────
  // Sin body — cruza por tarjetaLegada/monedero, no depende de ningún archivo subido. Arranca EN
  // BACKGROUND (mismo criterio que aplicarImportacion()/aplicarCorrecciones(): responde 202+jobId
  // de inmediato, el progreso/resultado final llegan por socket — ver
  // lealtadKoreMatchProgress$/Done$/Error$ en socket.service.ts). A diferencia de esos dos, acá no
  // hace falta subir ningún archivo: se puede re-correr en cualquier momento, cuantas veces haga
  // falta (idempotente, ver docstring de loyalty-kore-match.service.js en el backend).
  iniciarMatchKore(): Observable<LoyaltyKoreMatchJobIniciado> {
    return this.api.post<LoyaltyKoreMatchJobIniciado>('/loyalty/import/kore-match', {});
  }

  /** Fallback de recuperación (2026-10-23, hallazgo de resiliencia) — el backend ya lo exponía
   *  para la migración principal (GET /aplicar-job/:jobId) pero el equivalente de Kore
   *  (GET /kore-match-job/:jobId) nunca se consumía desde acá. Se usa para reintentar la
   *  descarga del Excel de detalle sin tener que re-correr el match completo contra Kore (ver
   *  reintentarDescargaExcelKoreMatch() en importar-clientes.component.ts). 404 si el job ya
   *  expiró (TTL del backend) o nunca existió. */
  obtenerEstadoMatchKoreJob(jobId: string): Observable<LoyaltyKoreMatchJobEstado> {
    return this.api.get<LoyaltyKoreMatchJobEstado>(`/loyalty/import/kore-match-job/${jobId}`);
  }
}
