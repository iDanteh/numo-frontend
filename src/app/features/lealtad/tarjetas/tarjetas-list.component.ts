import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyCard, LoyaltyNivel, LoyaltyCrearTarjetaResult,
  LoyaltyCardSortColumn, LoyaltySortDir, LoyaltyCardOrigen,
} from '../../../core/services/loyalty.service';
import { AuthService } from '../../../core/services/auth.service';
import { escapeHtml } from '../lealtad.constants';

/**
 * Lista de tarjetas (Main.dc.html) — búsqueda por teléfono/nombre + filtros
 * de nivel/activa, gated por loyalty:read (ya aplicado en app-routing.module
 * y en el guard de /lealtad). "+ Nueva tarjeta" solo visible con
 * loyalty:tarjetas:crear (spec loyalty-cards "Card Creation").
 */
@Component({
  standalone: false,
  selector: 'app-tarjetas-list',
  templateUrl: './tarjetas-list.component.html',
  styleUrls: ['./tarjetas-list.component.css'],
})
export class TarjetasListComponent implements OnInit, OnDestroy {
  cards: LoyaltyCard[] = [];
  loading = false;
  error = '';

  search = '';
  nivelFiltro: LoyaltyNivel | '' = '';
  activaFiltro: '' | 'true' | 'false' = '';
  // 2 fuentes de clientes (2026-10-27): el proceso que ya existía (alta manual + import de CSV,
  // "numo") vs. el webhook nuevo de catálogo de clientes de Kore ("kore").
  origenFiltro: LoyaltyCardOrigen | '' = '';

  // Búsqueda dinámica (2026-10-20): mismo patrón que collection-request.component.ts
  // (_wireSearch) — debounce + distinctUntilChanged para no disparar una consulta por
  // cada tecla, con auto-rearmado si la suscripción muere por un error inesperado.
  private search$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  // Columnas ordenables (2026-10-20). Default pedido por el usuario: saldo de
  // puntos descendente — quien tiene más puntos aparece primero en la lista.
  sortBy: LoyaltyCardSortColumn | null = 'saldo';
  sortDir: LoyaltySortDir = 'DESC';

  page = 1;
  totalPaginas = 1;
  readonly limit = 20;

  showCreateModal = false;

  // Activar/desactivar rápido desde la lista — mismo endpoint PATCH que
  // tarjeta-detail.component.ts guardarEdicion() (editarTarjeta, patch
  // parcial: solo manda `activa`, el backend no toca nombre/telefono).
  // Desactivar bloquea acumulaciones/canjes nuevos (spec "Deactivated card
  // blocks new movements"), por eso pide confirmación; reactivar no tiene
  // esa consecuencia y se aplica directo, sin modal.
  activaCambiandoId: string | null = null; // UUID (2026-10-29) — ver LoyaltyCard.id.
  confirmDesactivarCard: LoyaltyCard | null = null;
  activaError = '';

  // Panel de Reportes (2026-10-29) — sidebar propio (app-lealtad-reportes-panel), mismo patrón
  // showReportPanel/report-sidebar-backdrop que banks.component.ts.
  showReportesPanel = false;

  constructor(
    private loyalty: LoyaltyService,
    public auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.cargar();
    this._wireSearch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  canCrear(): boolean {
    return this.auth.hasPermission('loyalty:tarjetas:crear');
  }

  // Mismo literal que el actor sintético de loyalty-kore-cliente.service.js (backend) — única
  // forma de distinguir el origen sin una columna nueva en la tabla.
  esOrigenKore(card: LoyaltyCard): boolean {
    return card.createdById === 'kore-webhook';
  }

  // Gatea el botón de activar/desactivar rápido desde la lista — mismo permiso que
  // editarTarjeta (loyalty:tarjetas:editar, D6). Nombre histórico ("cambiar NIP" ya no
  // existe en esta pantalla, limpieza de UI 2026-11-04) — se deja así para no tocar el
  // resto de callers de este método.
  canCambiarNip(): boolean {
    return this.auth.hasPermission('loyalty:tarjetas:editar');
  }

  cargar(): void {
    this.loading = true;
    this.error = '';
    this.loyalty.listar({
      search: this.search.trim() || undefined,
      nivel: this.nivelFiltro || undefined,
      activa: this.activaFiltro === '' ? undefined : this.activaFiltro === 'true',
      origen: this.origenFiltro || undefined,
      page: this.page,
      limit: this.limit,
      sort: this.sortBy || undefined,
      sortDir: this.sortBy ? this.sortDir : undefined,
    }).subscribe({
      next: (res) => {
        this.cards = res.cards;
        this.totalPaginas = res.pages;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'No se pudieron cargar las tarjetas.';
      },
    });
  }

  buscar(): void {
    this.page = 1;
    this.cargar();
  }

  onSearchChange(): void {
    this.search$.next(this.search);
  }

  clearSearch(): void {
    this.search = '';
    this.page = 1;
    this.cargar();
    // Sin este next(''), distinctUntilChanged() se queda con el último término buscado
    // como "valor anterior" — mismo gap ya documentado/corregido en
    // collection-request.component.ts#clearSearch().
    this.search$.next('');
  }

  private _wireSearch(): void {
    this.search$.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe({
      next: () => {
        try {
          this.buscar();
        } catch (err) {
          console.error('[TarjetasListComponent] buscador: error sincrónico en buscar()', err);
        }
      },
      error: (err) => {
        console.error('[TarjetasListComponent] buscador: la suscripción murió, re-armando', err);
        this._wireSearch();
      },
    });
  }

  ordenarPor(columna: LoyaltyCardSortColumn): void {
    if (this.sortBy === columna) {
      this.sortDir = this.sortDir === 'ASC' ? 'DESC' : 'ASC';
    } else {
      this.sortBy = columna;
      this.sortDir = 'ASC';
    }
    this.page = 1;
    this.cargar();
  }

  cambiarPagina(delta: number): void {
    const nueva = this.page + delta;
    if (nueva < 1 || nueva > this.totalPaginas) return;
    this.page = nueva;
    this.cargar();
  }

  abrirDetalle(card: LoyaltyCard): void {
    this.router.navigate(['/lealtad/tarjetas', card.id]);
  }

  abrirCreateModal(): void {
    this.showCreateModal = true;
  }

  cerrarCreateModal(): void {
    this.showCreateModal = false;
  }

  onTarjetaCreada(result: LoyaltyCrearTarjetaResult): void {
    this.showCreateModal = false;
    this.cargar();
  }

  // Desactivar tiene una consecuencia real (bloquea movimientos nuevos) →
  // confirmación; reactivar no la tiene → directo.
  pedirToggleActiva(card: LoyaltyCard): void {
    if (card.activa) {
      this.confirmDesactivarCard = card;
    } else {
      this._aplicarToggleActiva(card);
    }
  }

  cerrarConfirmDesactivar(): void {
    this.confirmDesactivarCard = null;
  }

  get confirmDesactivarMsg(): string {
    if (!this.confirmDesactivarCard) return '';
    const nombreSeguro = escapeHtml(this.confirmDesactivarCard.nombre);
    return `¿Desactivar la tarjeta de <strong>${nombreSeguro}</strong>? No podrá recibir acumulaciones ni canjes nuevos hasta reactivarla.`;
  }

  confirmarDesactivar(): void {
    const card = this.confirmDesactivarCard;
    if (!card) return;
    this.confirmDesactivarCard = null;
    this._aplicarToggleActiva(card);
  }

  private _aplicarToggleActiva(card: LoyaltyCard): void {
    this.activaCambiandoId = card.id;
    this.activaError = '';
    this.loyalty.editarTarjeta(card.id, { activa: !card.activa }).subscribe({
      next: (updated) => {
        this.activaCambiandoId = null;
        card.activa = updated.activa;
      },
      error: (err) => {
        this.activaCambiandoId = null;
        this.activaError = err?.error?.error || 'No se pudo actualizar el estatus de la tarjeta.';
      },
    });
  }
}
