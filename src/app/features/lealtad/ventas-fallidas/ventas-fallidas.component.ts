import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { LoyaltyService, LoyaltyKoreVentaFallida } from '../../../core/services/loyalty.service';
import { escapeHtml } from '../lealtad.constants';

/**
 * Ventas de Kore que fallaron al procesar (webhook de venta: acumulación/canje de puntos) —
 * gateada por loyalty:config (mismo permiso que la ruta 'config' del shell de Lealtad, D10),
 * ruta/ítem de sidebar propios (no una pestaña dentro de lealtad-config.component): a diferencia
 * de esa pantalla (formularios de configuración), esta es una bandeja operativa de triage —
 * mismo tipo de pantalla que clientes-pendientes.component (lista + buscador + confirm-modal
 * antes de una acción irreversible), solo que sin buscador por texto libre (el volumen esperado
 * es bajo: solo las ventas que realmente fallaron).
 *
 * "Marcar como resuelto" es un ack manual — NO dispara ningún reproceso automático (decisión de
 * diseño ya confirmada con el usuario): Kore va a reenviar el mismo serieFolio por su cuenta y,
 * al ser idempotente, esta vez debería aplicar bien.
 */
@Component({
  standalone: false,
  selector: 'app-ventas-fallidas-lealtad',
  templateUrl: './ventas-fallidas.component.html',
  styleUrls: ['./ventas-fallidas.component.css'],
})
export class VentasFallidasLealtadComponent implements OnInit, OnDestroy {
  ventas: LoyaltyKoreVentaFallida[] = [];
  loading = false;
  error = '';

  // Default true (pedido explícito del usuario) — la bandeja arranca mostrando solo lo que
  // todavía necesita atención; "Todas" también trae las ya resueltas, para auditoría/histórico.
  soloNoResueltas = true;

  // Fila expandida para ver `payloadRecibido` (una a la vez, mismo criterio que historyModal en
  // lealtad-config.component.ts: un solo panel/detalle abierto a la vez en esta pantalla).
  expandedId: number | null = null;

  resolviendo: Record<number, boolean> = {};

  // Confirmación vía app-confirm-modal (mismo patrón que tarjetas-list/tarjeta-detail/
  // clientes-pendientes) en vez de confirm() nativo del navegador.
  confirmResolverVenta: LoyaltyKoreVentaFallida | null = null;

  private destroy$ = new Subject<void>();

  constructor(private loyalty: LoyaltyService) {}

  ngOnInit(): void {
    this.cargar();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cargar(): void {
    this.loading = true;
    this.error = '';
    this.loyalty.listarVentasFallidas(this.soloNoResueltas).pipe(takeUntil(this.destroy$)).subscribe({
      next: (ventas) => {
        this.ventas = ventas;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'No se pudieron cargar las ventas fallidas de Kore.';
      },
    });
  }

  /** Cambia el filtro "Solo no resueltas" / "Todas" — vuelve a pedir la lista completa, no hay
   *  paginación de por medio (ver LoyaltyService.listarVentasFallidas). */
  cambiarFiltro(soloNoResueltas: boolean): void {
    if (this.soloNoResueltas === soloNoResueltas) return;
    this.soloNoResueltas = soloNoResueltas;
    this.expandedId = null;
    this.cargar();
  }

  toggleDetalle(id: number): void {
    this.expandedId = this.expandedId === id ? null : id;
  }

  /** `payloadRecibido` es JSON.stringify crudo del body recibido de Kore — solo para diagnóstico,
   *  nunca vale la pena parsearlo a una tabla. Pre-formateado dentro de un <pre>; si por algún
   *  motivo no parsea como JSON válido, se muestra tal cual en vez de romper la pantalla. */
  payloadFormateado(venta: LoyaltyKoreVentaFallida): string {
    try {
      return JSON.stringify(JSON.parse(venta.payloadRecibido), null, 2);
    } catch {
      return venta.payloadRecibido;
    }
  }

  /** Pide confirmación antes de marcar resuelto (acción irreversible, igual que rechazar() en
   *  clientes-pendientes.component.ts) — confirmarResolver() ejecuta la acción real. */
  marcarResuelto(venta: LoyaltyKoreVentaFallida): void {
    this.confirmResolverVenta = venta;
  }

  cerrarConfirmResolver(): void {
    this.confirmResolverVenta = null;
  }

  // app-confirm-modal bindea [msg] con [innerHTML] — serieFolio es texto libre (viene del body de
  // Kore), hay que escaparlo antes de concatenar el <strong>, mismo criterio que confirmRechazarMsg
  // en clientes-pendientes.component.ts.
  get confirmResolverMsg(): string {
    if (!this.confirmResolverVenta) return '';
    const serieFolioSeguro = escapeHtml(this.confirmResolverVenta.serieFolio || 'esta venta');
    return `¿Marcar como resuelta la venta <strong>${serieFolioSeguro}</strong>? Esto NO reprocesa nada automáticamente — `
      + 'Kore va a reenviar la misma venta y, si la causa raíz ya quedó corregida, debería aplicar bien.';
  }

  confirmarResolver(): void {
    const venta = this.confirmResolverVenta;
    if (!venta) return;
    this.confirmResolverVenta = null;

    this.resolviendo[venta.id] = true;
    this.error = '';

    this.loyalty.marcarVentaFallidaResuelta(venta.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (actualizada) => {
        delete this.resolviendo[venta.id];
        if (this.expandedId === venta.id) this.expandedId = null;
        if (this.soloNoResueltas) {
          // Ya no matchea el filtro activo — se quita de la lista en vez de recargar todo.
          this.ventas = this.ventas.filter((v) => v.id !== venta.id);
        } else {
          this.ventas = this.ventas.map((v) => (v.id === actualizada.id ? actualizada : v));
        }
      },
      error: (err) => {
        delete this.resolviendo[venta.id];
        this.error = err?.error?.error || 'No se pudo marcar la venta como resuelta.';
      },
    });
  }
}
