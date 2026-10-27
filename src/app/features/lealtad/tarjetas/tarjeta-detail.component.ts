import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { AnimationItem } from 'lottie-web';
import {
  LoyaltyService, LoyaltyCard, LoyaltyMovimiento, LoyaltyTierHistoryEntry, LoyaltyNivel,
  LoyaltyMovimientoResult, LoyaltySucursal, LoyaltyAdjustmentReason, LoyaltyCardDatosAdicionales,
} from '../../../core/services/loyalty.service';
import { AuthService } from '../../../core/services/auth.service';
import { NIP_ERROR_FALLBACK } from '../lealtad.constants';
import { MovimientoMode } from './movimiento-modal.component';

const NIVELES: LoyaltyNivel[] = ['Bronce', 'Plata', 'Oro'];

// Rediseño (2026-10-20): la tabla de movimientos mostraba el enum crudo
// (ACUMULACION/CANJE/AJUSTE) — esto lo traduce a una etiqueta legible.
const TIPO_LABELS: Record<string, string> = {
  ACUMULACION: 'Acumulación',
  CANJE: 'Canje',
  AJUSTE: 'Ajuste',
  MIGRACION: 'Migración',
};

/**
 * Detalle de tarjeta (spec loyalty-cards/loyalty-points-ledger): header con
 * el teléfono como "No. de tarjeta" (D1, nunca un numeroTarjeta separado),
 * nivel, saldo, ledger + historial de niveles, y acciones gated por los 7
 * permisos granulares (design.md "Routes and Permissions").
 */
@Component({
  standalone: false,
  selector: 'app-tarjeta-detail',
  templateUrl: './tarjeta-detail.component.html',
  styleUrls: ['./tarjeta-detail.component.css'],
})
export class TarjetaDetailComponent implements OnInit, OnDestroy {
  readonly id: number;

  card: LoyaltyCard | null = null;
  movimientos: LoyaltyMovimiento[] = [];
  movPage = 1;
  movTotalPaginas = 1;
  tierHistory: LoyaltyTierHistoryEntry[] = [];

  loading = false;
  error = '';

  // Edición (nombre/teléfono/activa) — loyalty:tarjetas:editar
  editMode = false;
  editNombre = '';
  editTelefono = '';
  editActiva = true;
  editSaving = false;
  editError = '';

  // "Datos adicionales" (2026-10-23) — mismos campos del enriquecimiento del import de
  // clientes.csv, ahora también editables a mano. `GET /cards/:id` (el `card` ya cargado) no los
  // trae (defaultScope los excluye por PII) — se piden aparte vía obtenerParaEditar() recién al
  // entrar en modo edición, bajo el mismo permiso loyalty:tarjetas:editar.
  editDatos: LoyaltyCardDatosAdicionales = {};
  editDatosLoading = false;

  // Movimiento (acumulacion/canje/ajuste) — loyalty:movimientos / loyalty:ajustes
  movimientoMode: MovimientoMode | null = null;

  // Cambio de nivel — loyalty:tarjetas:nivel
  showNivelForm = false;
  nuevoNivel: LoyaltyNivel | '' = '';
  motivoNivel = '';
  nivelSaving = false;
  nivelError = '';

  // Cambiar NIP — loyalty:tarjetas:editar (mismo permiso que editarTarjeta, D6)
  nipReveal: { nombre: string; nip: string } | null = null;
  showConfirmNip = false;
  nipSaving = false;
  nipError = '';

  readonly niveles = NIVELES;

  // Detalle expandible por movimiento (2026-10-19, pedido explícito del usuario): el backend
  // ya guarda montoVenta/porcentajeAplicado/nivelAplicado/justificacion/centroCosto/usuario por
  // cada movimiento desde siempre — esto solo lo hace visible. sucursales/reasons se cargan una
  // vez para resolver centroCostoId/reasonId a un nombre legible en vez de mostrar el ID crudo.
  // Set, no un solo id (2026-10-27, pedido explícito del usuario): antes expandir una fila
  // colapsaba cualquier otra abierta (acordeón) — ahora cada fila guarda su propio estado.
  movimientosExpandidosIds = new Set<number>();
  sucursales: LoyaltySucursal[] = [];
  reasons: LoyaltyAdjustmentReason[] = [];

  // Lottie de carga (2026-10-19, pedido explícito del usuario en lugar de un texto plano
  // "Cargando tarjeta…") — animación "Loader Payment Credit Card" provista por el usuario
  // (public/lottie/loader-payment-credit-card.json), NO la de los 3 puntos genérica de la
  // primera versión. lottie-web cargado de forma diferida (mismo criterio que
  // `await import('exceljs')` ya usado en otras pantallas de este frontend, no infla el
  // bundle inicial). El setter del ViewChild se dispara cada vez que el *ngIf que envuelve
  // #lottieHost lo crea o lo destruye — así se re-inicia solo si el usuario vuelve a entrar
  // a una tarjeta distinta mientras esta sigue montada.
  private _lottieAnim: AnimationItem | null = null;

  // Piso de duración del Lottie (2026-10-20, pedido explícito del usuario): sin esto la
  // animación dura exactamente lo que tarda la petición real y parpadea feo cuando responde
  // en 50-100ms.
  private readonly LOTTIE_MIN_MS = 1800;
  private _lottieTimeout: ReturnType<typeof setTimeout> | null = null;

  @ViewChild('lottieHost') set lottieHost(el: ElementRef<HTMLDivElement> | undefined) {
    this._lottieAnim?.destroy();
    this._lottieAnim = null;
    if (!el) return;

    import('lottie-web').then(({ default: lottie }) => {
      this._lottieAnim = lottie.loadAnimation({
        container: el.nativeElement,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: 'lottie/loader-payment-credit-card.json',
      });
    });
  }

  constructor(
    route: ActivatedRoute,
    private loyalty: LoyaltyService,
    public auth: AuthService,
  ) {
    this.id = Number(route.snapshot.paramMap.get('id'));
  }

  ngOnInit(): void {
    this.cargarCard();
    this.cargarMovimientos();
    this.cargarTierHistory();
    this.loyalty.listarSucursales().subscribe((s) => { this.sucursales = s; });
    this.loyalty.listarReasons().subscribe((r) => { this.reasons = r; });
  }

  toggleMovimiento(m: LoyaltyMovimiento): void {
    if (this.movimientosExpandidosIds.has(m.id)) {
      this.movimientosExpandidosIds.delete(m.id);
    } else {
      this.movimientosExpandidosIds.add(m.id);
    }
  }

  // Historial plegable (2026-10-20, pedido explícito del usuario: evitar que
  // las tablas de historial ocupen tanto espacio vertical). Ambas arrancan
  // cerradas por default — el usuario decide cuál abrir.
  historialMovAbierto = false;
  historialNivelesAbierto = false;

  toggleHistorialMov(): void {
    this.historialMovAbierto = !this.historialMovAbierto;
  }

  toggleHistorialNiveles(): void {
    this.historialNivelesAbierto = !this.historialNivelesAbierto;
  }

  tipoLabel(tipo: string): string {
    return TIPO_LABELS[tipo] ?? tipo;
  }

  nombreSucursal(id: number | null): string {
    if (id == null) return '—';
    return this.sucursales.find((s) => s.id === id)?.sucursal ?? `#${id}`;
  }

  nombreReason(id: number | null): string {
    if (id == null) return '—';
    return this.reasons.find((r) => r.id === id)?.nombre ?? `#${id}`;
  }

  // Desglose transaccional (2026-10-27, pedido explícito del usuario): el monto que realmente
  // entró al cálculo. Fallback a montoVenta para filas de antes de este campo (lo traen null) —
  // en esas no hubo prorrateo documentado aparte, montoVenta ya era el monto real usado.
  montoCalculo(m: LoyaltyMovimiento): number | null {
    return m.montoBaseCalculo ?? m.montoVenta;
  }

  // Solo true cuando el monto realmente usado en el cálculo difiere del subtotal completo de la
  // venta (formas de pago mixtas en el webhook) — así la UI solo aclara el prorrateo cuando aplica,
  // sin ruido en el caso normal (manual, o webhook con una sola forma de pago que acumula).
  huboProrrateo(m: LoyaltyMovimiento): boolean {
    if (m.montoBaseCalculo == null || m.montoVenta == null) return false;
    return Math.abs(m.montoBaseCalculo - m.montoVenta) > 0.01;
  }

  cargarCard(): void {
    this.loading = true;
    this.error = '';
    const inicio = Date.now();
    this.loyalty.obtener(this.id).subscribe({
      next: (card) => this._conDuracionMinima(inicio, () => { this.card = card; this.loading = false; }),
      error: (err) => this._conDuracionMinima(inicio, () => {
        this.loading = false;
        this.error = err?.error?.error || 'No se pudo cargar la tarjeta.';
      }),
    });
  }

  // Ejecuta cb() de inmediato si ya pasó el piso de duración, o cuando falte para completarlo.
  private _conDuracionMinima(inicio: number, cb: () => void): void {
    const falta = this.LOTTIE_MIN_MS - (Date.now() - inicio);
    if (falta > 0) {
      this._lottieTimeout = setTimeout(cb, falta);
    } else {
      cb();
    }
  }

  cargarMovimientos(page = 1): void {
    this.loyalty.listarMovimientos(this.id, page, 20).subscribe((res) => {
      this.movimientos = res.movimientos;
      this.movPage = res.page;
      this.movTotalPaginas = res.pages;
    });
  }

  cargarTierHistory(): void {
    this.loyalty.listarNiveles(this.id).subscribe(h => this.tierHistory = h);
  }

  cambiarPaginaMov(delta: number): void {
    const nueva = this.movPage + delta;
    if (nueva < 1 || nueva > this.movTotalPaginas) return;
    this.cargarMovimientos(nueva);
  }

  // ── Permisos (design.md "Routes and Permissions") ──────────────────────
  canEditar():      boolean { return this.auth.hasPermission('loyalty:tarjetas:editar'); }
  canMovimientos(): boolean { return this.auth.hasPermission('loyalty:movimientos'); }
  canAjustes():     boolean { return this.auth.hasPermission('loyalty:ajustes'); }
  canNivel():       boolean { return this.auth.hasPermission('loyalty:tarjetas:nivel'); }
  // POST /cards/:id/nip usa LOYALTY_TARJETAS_EDITAR — mismo permiso que editar.
  canCambiarNip():  boolean { return this.canEditar(); }

  /** ACUMULACION/CANJE quedan bloqueados en una tarjeta inactiva (spec
   *  "Deactivated card blocks new movements"); AJUSTE no tiene esa
   *  restricción en la spec. */
  puedeMovimiento(mode: MovimientoMode): boolean {
    if (!this.card) return false;
    if (mode === 'ajuste') return this.canAjustes();
    if (!this.card.activa) return false;
    return this.canMovimientos();
  }

  // ── Edición de nombre/teléfono/activa ───────────────────────────────────
  iniciarEdicion(): void {
    if (!this.card) return;
    this.editNombre   = this.card.nombre;
    this.editTelefono = this.card.telefono;
    this.editActiva   = this.card.activa;
    this.editError    = '';
    this.editDatos    = {};
    this.editMode      = true;

    // "Datos adicionales" no vienen en `card` (defaultScope los excluye) — se piden aparte, sin
    // bloquear el resto del formulario mientras llegan.
    this.editDatosLoading = true;
    this.loyalty.obtenerParaEditar(this.card.id).subscribe({
      next: (card) => {
        const { apellidos, apodo, sexo, fechaNacimiento, especialidades, sucursal, calle,
          numExterior, numInterior, colonia, municipio, estado, cp, comentarios } = card as LoyaltyCardDatosAdicionales;
        this.editDatos = { apellidos, apodo, sexo, fechaNacimiento, especialidades, sucursal, calle,
          numExterior, numInterior, colonia, municipio, estado, cp, comentarios };
        this.editDatosLoading = false;
      },
      error: () => {
        // No bloquea la edición de nombre/teléfono/activa — solo "Datos adicionales" queda vacío.
        this.editDatosLoading = false;
      },
    });
  }

  cancelarEdicion(): void {
    this.editMode  = false;
    this.editError = '';
  }

  guardarEdicion(): void {
    if (!this.card || this.editSaving) return;
    this.editSaving = true;
    this.editError  = '';
    this.loyalty.editarTarjeta(this.card.id, {
      nombre: this.editNombre.trim(),
      telefono: this.editTelefono.trim(),
      activa: this.editActiva,
      ...this.editDatos,
    }).subscribe({
      next: (card) => {
        this.card = card;
        this.editSaving = false;
        this.editMode   = false;
      },
      error: (err) => {
        this.editSaving = false;
        this.editError  = err?.error?.error || 'No se pudo guardar la edición.';
      },
    });
  }

  // ── Movimientos (acumulación/canje/ajuste) ──────────────────────────────
  abrirMovimiento(mode: MovimientoMode): void {
    this.movimientoMode = mode;
  }

  cerrarMovimiento(): void {
    this.movimientoMode = null;
  }

  onMovimientoRegistrado(result: LoyaltyMovimientoResult): void {
    if (this.card) this.card.saldoPuntos = result.saldoPuntos;
    // Acumulación con promoción vigente (2026-10-27) llega como DOS filas separadas (nivel +
    // promoción) — la de promoción se creó después, va primero para que el orden local coincida
    // con el `ORDER BY created_at DESC` que usa listarMovimientos() en el próximo refresh.
    const nuevos = [result.movimientoPromocion, result.movimiento].filter((m): m is LoyaltyMovimiento => !!m);
    this.movimientos = [...nuevos, ...this.movimientos];
    this.movimientoMode = null;
  }

  // ── Cambio de nivel (manual, con auditoría — spec "Manual Tier Change With Audit") ──
  iniciarCambioNivel(): void {
    if (!this.card) return;
    this.nuevoNivel  = this.card.nivel;
    this.motivoNivel = '';
    this.nivelError  = '';
    this.showNivelForm = true;
  }

  cancelarCambioNivel(): void {
    this.showNivelForm = false;
    this.nivelError = '';
  }

  guardarNivel(): void {
    if (!this.card || this.nivelSaving) return;
    if (!this.nuevoNivel || this.nuevoNivel === this.card.nivel) {
      this.nivelError = 'Selecciona un nivel distinto al actual.';
      return;
    }
    this.nivelSaving = true;
    this.nivelError  = '';
    this.loyalty.cambiarNivel(this.card.id, this.nuevoNivel, this.motivoNivel.trim() || undefined).subscribe({
      next: (card) => {
        this.card = card;
        this.nivelSaving   = false;
        this.showNivelForm = false;
        this.cargarTierHistory();
      },
      error: (err) => {
        this.nivelSaving = false;
        this.nivelError  = err?.error?.error || 'No se pudo cambiar el nivel.';
      },
    });
  }

  // ── Cambiar NIP (spec "NIP Set and Reset") ──────────────────────────────
  pedirCambiarNip(): void {
    if (!this.card) return;
    this.nipError = '';
    this.showConfirmNip = true;
  }

  cancelarCambiarNip(): void {
    this.showConfirmNip = false;
  }

  confirmarCambiarNip(): void {
    if (!this.card || this.nipSaving) return;
    this.showConfirmNip = false;
    this.nipSaving = true;
    this.nipError = '';
    this.loyalty.cambiarNip(this.card.id).subscribe({
      next: (res) => {
        this.nipSaving = false;
        this.nipReveal = { nombre: this.card!.nombre, nip: res.nip };
        // Refresca la tarjeta — el backend ya registra quién/cuándo (updatedById/updatedByNombre,
        // 2026-10-19) y el header lo muestra ("Última edición"); sin este refresh quedaría
        // desactualizado hasta la próxima carga de la página.
        this.cargarCard();
      },
      error: (err) => {
        this.nipSaving = false;
        this.nipError = err?.error?.error || NIP_ERROR_FALLBACK;
      },
    });
  }

  cerrarNipReveal(): void {
    this.nipReveal = null;
  }

  ngOnDestroy(): void {
    this._lottieAnim?.destroy();
    if (this._lottieTimeout) clearTimeout(this._lottieTimeout);
  }
}
