import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  LoyaltyService, LoyaltyCard, LoyaltyMovimiento, LoyaltyTierHistoryEntry, LoyaltyNivel,
  LoyaltyMovimientoResult,
} from '../../../core/services/loyalty.service';
import { AuthService } from '../../../core/services/auth.service';
import { MovimientoMode } from './movimiento-modal.component';

const NIVELES: LoyaltyNivel[] = ['Bronce', 'Plata', 'Oro'];

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
export class TarjetaDetailComponent implements OnInit {
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

  readonly niveles = NIVELES;

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
  }

  cargarCard(): void {
    this.loading = true;
    this.error = '';
    this.loyalty.obtener(this.id).subscribe({
      next: (card) => { this.card = card; this.loading = false; },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'No se pudo cargar la tarjeta.';
      },
    });
  }

  cargarMovimientos(page = 1): void {
    this.loyalty.listarMovimientos(this.id, page, 20).subscribe((res) => {
      this.movimientos = res.data;
      this.movPage = res.pagination.page;
      this.movTotalPaginas = res.pagination.totalPaginas;
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
    this.editMode      = true;
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
    this.movimientos = [result.movimiento, ...this.movimientos];
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
  cambiarNip(): void {
    if (!this.card) return;
    this.loyalty.cambiarNip(this.card.id).subscribe((res) => {
      this.nipReveal = { nombre: this.card!.nombre, nip: res.nip };
    });
  }

  cerrarNipReveal(): void {
    this.nipReveal = null;
  }
}
