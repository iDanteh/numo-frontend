import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service';
import {
  LoyaltyService, LoyaltySecurityEvent, LoyaltySecurityEventTipo, LoyaltyKoreVentaLog,
} from '../../../core/services/loyalty.service';

/**
 * Concentrado de auditoría de Lealtad (2026-11-13, pedido explícito del usuario) — una sola
 * pantalla con 3 pestañas, cada una gateada por el permiso real de su propio endpoint:
 *
 *   - "Eventos OTP" (loyalty:auditoria, NUEVO): consulta pública + canje con Kore, filtrable por
 *     teléfono/tipo/resultado/rango de fechas — GET /loyalty/auditoria/eventos-seguridad. Es la
 *     única pestaña con UI propia construida en esta pantalla; nunca muestra el código OTP en sí
 *     (decisión de seguridad ya tomada, ver loyalty-security-event.service.js).
 *   - "Ventas fallidas" (loyalty:config): reusa tal cual VentasFallidasLealtadComponent, que ya
 *     existe con su propia ruta/ítem de sidebar (/lealtad/ventas-fallidas) — se embebe acá SOLO
 *     para tener el concentrado en un solo lugar, sin duplicar su lógica.
 *   - "Ventas canceladas" (loyalty:config): mismo criterio, reusa VentasCanceladasAuditoriaLealtadComponent
 *     (/lealtad/ventas-canceladas).
 *
 * Las rutas/ítems de sidebar individuales de esas dos pestañas NO se tocan ni se eliminan — siguen
 * existiendo como acceso directo, esta pantalla es un acceso ADICIONAL, consolidado.
 */
@Component({
  standalone: false,
  selector: 'app-auditoria-lealtad',
  templateUrl: './auditoria-lealtad.component.html',
  styleUrls: ['./auditoria-lealtad.component.css'],
})
export class AuditoriaLealtadComponent implements OnInit, OnDestroy {
  pestana: 'eventos' | 'ventas-fallidas' | 'ventas-canceladas' | 'pagos-kore' = 'eventos';

  eventos: LoyaltySecurityEvent[] = [];
  total = 0;
  loading = false;
  error = '';

  // Filtros — el backend ya valida formato/rango (400 si "desde"/"hasta" no son fecha válida, o
  // "resultado" no es exito/fallo), acá solo se arman los params.
  telefono = '';
  tipo: LoyaltySecurityEventTipo | '' = '';
  resultado: 'exito' | 'fallo' | '' = '';
  desde = '';
  hasta = '';

  readonly LIMIT = 50;
  offset = 0;
  // Expuesto para el template (al-pager) — Angular no da acceso a globals dentro del HTML.
  readonly Math = Math;

  // ── Pagos Kore: /venta y /ventas (2026-11-17, pedido explícito del usuario) ──────────────────
  // Payload crudo por fila — colapsado por default (puede ser grande, sobre todo en /ventas con
  // varias ventas en el mismo request), se expande con expandirPago().
  pagosKore: LoyaltyKoreVentaLog[] = [];
  totalPagos = 0;
  loadingPagos = false;
  errorPagos = '';
  pagosExpandidos = new Set<number>();

  resultadoPagos: 'exito' | 'error' | '' = '';
  endpointPagos: 'venta' | 'ventas' | '' = '';
  desdePagos = '';
  hastaPagos = '';
  offsetPagos = 0;
  serieFolioPagos = '';
  telefonoPagos = '';
  puntosAbonadosPagos = '';

  readonly TIPOS: { value: LoyaltySecurityEventTipo; label: string; grupo: string }[] = [
    { value: 'solicitud_codigo', label: 'Solicitud de código', grupo: 'Consulta pública' },
    { value: 'confirmacion_codigo', label: 'Confirmación de código', grupo: 'Consulta pública' },
    { value: 'ver_consulta', label: 'Ver de nuevo (sesión)', grupo: 'Consulta pública' },
    { value: 'guardar_email', label: 'Guardar correo de contacto', grupo: 'Consulta pública' },
    { value: 'solicitud_codigo_canje', label: 'Solicitud de código de canje', grupo: 'Canje (Kore)' },
    { value: 'confirmacion_codigo_canje', label: 'Confirmación de código de canje', grupo: 'Canje (Kore)' },
  ];

  private destroy$ = new Subject<void>();

  constructor(private loyalty: LoyaltyService, public auth: AuthService) {}

  ngOnInit(): void {
    // canVerPagosKore() usa el MISMO permiso que canVerEventos() (loyalty:auditoria) a propósito
    // — nunca hace falta un fallback separado para "pagos-kore" acá: si no se puede ver "eventos",
    // tampoco se puede ver "pagos-kore".
    if (this.canVerEventos()) {
      this.cargarEventos();
    } else if (this.canVerVentasFallidas() || this.canVerVentasCanceladas()) {
      // Sin permiso de la pestaña por default — arranca en la primera que sí pueda ver.
      this.pestana = this.canVerVentasFallidas() ? 'ventas-fallidas' : 'ventas-canceladas';
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Mismo contrato que LealtadShellComponent.canSee() — un permiso por pestaña. */
  canVerEventos(): boolean { return this.auth.hasPermission('loyalty:auditoria'); }
  canVerVentasFallidas(): boolean { return this.auth.hasPermission('loyalty:config'); }
  canVerVentasCanceladas(): boolean { return this.auth.hasPermission('loyalty:config'); }
  canVerPagosKore(): boolean { return this.auth.hasPermission('loyalty:auditoria'); }

  cambiarPestana(p: 'eventos' | 'ventas-fallidas' | 'ventas-canceladas' | 'pagos-kore'): void {
    if (this.pestana === p) return;
    this.pestana = p;
    if (p === 'eventos' && !this.eventos.length && !this.loading) this.cargarEventos();
    if (p === 'pagos-kore' && !this.pagosKore.length && !this.loadingPagos) this.cargarPagosKore();
  }

  cargarEventos(): void {
    this.loading = true;
    this.error = '';
    this.loyalty.listarEventosSeguridad({
      telefono: this.telefono.trim() || undefined,
      tipo: this.tipo || undefined,
      resultado: this.resultado || undefined,
      desde: this.desde || undefined,
      hasta: this.hasta || undefined,
      limit: this.LIMIT,
      offset: this.offset,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.eventos = res.eventos;
        this.total = res.total;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'No se pudieron cargar los eventos de auditoría.';
      },
    });
  }

  /** Cualquier cambio de filtro reinicia la paginación — mismo criterio que el resto de tablas
   *  filtrables del proyecto (ej. tarjetas-list.component.ts). */
  aplicarFiltros(): void {
    this.offset = 0;
    this.cargarEventos();
  }

  limpiarFiltros(): void {
    this.telefono = '';
    this.tipo = '';
    this.resultado = '';
    this.desde = '';
    this.hasta = '';
    this.aplicarFiltros();
  }

  onRango(rango: { fechaInicio: string; fechaFin: string }): void {
    this.desde = rango.fechaInicio;
    this.hasta = rango.fechaFin;
    this.aplicarFiltros();
  }

  paginaAnterior(): void {
    if (this.offset === 0) return;
    this.offset = Math.max(0, this.offset - this.LIMIT);
    this.cargarEventos();
  }

  paginaSiguiente(): void {
    if (this.offset + this.LIMIT >= this.total) return;
    this.offset += this.LIMIT;
    this.cargarEventos();
  }

  tipoLabel(tipo: LoyaltySecurityEventTipo): string {
    return this.TIPOS.find(t => t.value === tipo)?.label ?? tipo;
  }

  // ── Pagos Kore: /venta y /ventas ──────────────────────────────────────────────────────────
  cargarPagosKore(): void {
    this.loadingPagos = true;
    this.errorPagos = '';
    this.loyalty.listarVentasLogKore({
      resultado: this.resultadoPagos || undefined,
      endpoint: this.endpointPagos || undefined,
      desde: this.desdePagos || undefined,
      hasta: this.hastaPagos || undefined,
      limit: this.LIMIT,
      offset: this.offsetPagos,
      serieFolio: this.serieFolioPagos.trim() || undefined,
      telefono: this.telefonoPagos.trim() || undefined,
      puntosAbonados: this.puntosAbonadosPagos.trim() || undefined,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.pagosKore = res.logs;
        this.totalPagos = res.total;
        this.loadingPagos = false;
      },
      error: (err) => {
        this.loadingPagos = false;
        this.errorPagos = err?.error?.error || 'No se pudieron cargar los pagos de Kore.';
      },
    });
  }

  aplicarFiltrosPagos(): void {
    this.offsetPagos = 0;
    this.cargarPagosKore();
  }

  limpiarFiltrosPagos(): void {
    this.resultadoPagos = '';
    this.endpointPagos = '';
    this.desdePagos = '';
    this.hastaPagos = '';
    this.serieFolioPagos = '';
    this.telefonoPagos = '';
    this.puntosAbonadosPagos = '';
    this.aplicarFiltrosPagos();
  }

  onRangoPagos(rango: { fechaInicio: string; fechaFin: string }): void {
    this.desdePagos = rango.fechaInicio;
    this.hastaPagos = rango.fechaFin;
    this.aplicarFiltrosPagos();
  }

  paginaAnteriorPagos(): void {
    if (this.offsetPagos === 0) return;
    this.offsetPagos = Math.max(0, this.offsetPagos - this.LIMIT);
    this.cargarPagosKore();
  }

  paginaSiguientePagos(): void {
    if (this.offsetPagos + this.LIMIT >= this.totalPagos) return;
    this.offsetPagos += this.LIMIT;
    this.cargarPagosKore();
  }

  /** El payload puede ser grande (sobre todo /ventas con varias ventas) — colapsado por default. */
  toggleExpandirPago(id: number): void {
    if (this.pagosExpandidos.has(id)) this.pagosExpandidos.delete(id);
    else this.pagosExpandidos.add(id);
  }

  payloadFormateado(payload: Record<string, unknown>): string {
    return JSON.stringify(payload, null, 2);
  }
}
