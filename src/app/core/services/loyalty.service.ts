import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  LoyaltyCardListFilter, LoyaltyCardListResult, LoyaltyCard,
  LoyaltyCrearTarjetaPayload, LoyaltyCrearTarjetaResult, LoyaltyEditarTarjetaPayload,
  LoyaltyCambiarNipResult, LoyaltyMovimientoListResult, LoyaltyTierHistoryEntry,
  LoyaltyAcumulacionPayload, LoyaltyCanjePayload, LoyaltyAjustePayload, LoyaltyMovimientoResult,
  LoyaltyPorcentajes, LoyaltyAdjustmentReason, LoyaltySucursal,
  LoyaltyGuardarPorcentajesPayload, LoyaltyCrearReasonPayload, LoyaltyEditarReasonPayload,
  LoyaltyActualizarSucursalPayload, LoyaltyConsultaPublicaResult,
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
  constructor(private api: ApiService) {}

  listar(filter: LoyaltyCardListFilter = {}): Observable<LoyaltyCardListResult> {
    const params: Record<string, unknown> = {};
    if (filter.search)        params['search'] = filter.search;
    if (filter.nivel)         params['nivel']  = filter.nivel;
    if (filter.activa !== undefined && filter.activa !== '') params['activa'] = filter.activa;
    if (filter.page != null)  params['page']  = filter.page;
    if (filter.limit != null) params['limit'] = filter.limit;
    return this.api.get<LoyaltyCardListResult>('/loyalty/cards', params);
  }

  crearTarjeta(payload: LoyaltyCrearTarjetaPayload): Observable<LoyaltyCrearTarjetaResult> {
    return this.api.post<LoyaltyCrearTarjetaResult>('/loyalty/cards', payload);
  }

  obtener(id: number): Observable<LoyaltyCard> {
    return this.api.get<LoyaltyCard>(`/loyalty/cards/${id}`);
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
    return this.api.get<LoyaltySucursal[]>('/loyalty/sucursales');
  }

  // ── PR7: Config UI (loyalty:config) ───────────────────────────────────────

  guardarPorcentajes(payload: LoyaltyGuardarPorcentajesPayload): Observable<LoyaltyPorcentajes> {
    return this.api.put<LoyaltyPorcentajes>('/loyalty/config/porcentajes', payload);
  }

  crearReason(payload: LoyaltyCrearReasonPayload): Observable<LoyaltyAdjustmentReason> {
    return this.api.post<LoyaltyAdjustmentReason>('/loyalty/reasons', payload);
  }

  editarReason(id: number, payload: LoyaltyEditarReasonPayload): Observable<LoyaltyAdjustmentReason> {
    return this.api.patch<LoyaltyAdjustmentReason>(`/loyalty/reasons/${id}`, payload);
  }

  actualizarSucursal(id: number, payload: LoyaltyActualizarSucursalPayload): Observable<LoyaltySucursal> {
    return this.api.patch<LoyaltySucursal>(`/loyalty/sucursales/${id}`, payload);
  }

  // Consulta pública (D13: '/loyalty/public/' está excluido del uriMatcher de
  // AuthHttpInterceptor en app.module.ts — esta llamada sale sin Bearer, haya
  // o no sesión iniciada). Nunca se cachea: '/loyalty/' está en
  // NO_CACHE_PATTERNS (http-cache.interceptor.ts, PR5).
  consultaPublica(telefono: string, nip: string): Observable<LoyaltyConsultaPublicaResult> {
    return this.api.post<LoyaltyConsultaPublicaResult>('/loyalty/public/consulta', { telefono, nip });
  }
}
