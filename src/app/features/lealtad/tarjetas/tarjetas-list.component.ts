import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyCard, LoyaltyKoreNivel, LoyaltyCrearTarjetaResult,
  LoyaltyCardSortColumn, LoyaltySortDir, LoyaltyCardOrigen,
} from '../../../core/services/loyalty.service';
import { AuthService } from '../../../core/services/auth.service';
import { SocketService } from '../../../core/services/socket.service';

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
  // string (no LoyaltyNivel) a propósito (2026-11-17): el catálogo de niveles lo gestiona Kore y
  // puede traer cualquier nombre nuevo (ver LoyaltyKoreNivel) — las opciones de este filtro ya no
  // son un set fijo, se cargan de `nivelesCatalogo` (ver `_cargarNivelesCatalogo()`).
  nivelFiltro = '';
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

  // Panel de Reportes (2026-10-29) — sidebar propio (app-lealtad-reportes-panel), mismo patrón
  // showReportPanel/report-sidebar-backdrop que banks.component.ts.
  showReportesPanel = false;

  // Opciones del filtro de nivel (2026-11-17) — antes 3 valores hardcodeados (Bronce/Plata/Oro),
  // desincronizados del catálogo real gestionado por Kore (le faltaba Azul y cualquier nivel
  // nuevo, ej. "Esmeralda"). Se cargan del mismo catálogo que ya usa "Niveles Kore" en
  // Configuración de Tuberos (ver lealtad-config.component.ts#cargarNivelesKore), solo activos —
  // no bloquea la carga de tarjetas si falla, el filtro simplemente queda sin opciones.
  nivelesCatalogo: LoyaltyKoreNivel[] = [];

  constructor(
    private loyalty: LoyaltyService,
    public auth: AuthService,
    private router: Router,
    private socketService: SocketService,
  ) {}

  ngOnInit(): void {
    this.cargar();
    this._wireSearch();
    this._cargarNivelesCatalogo();
    // Notificación en vivo (2026-11-17, bug real: el webhook de catálogo de clientes de Kore
    // actualiza/desactiva tarjetas y esta lista nunca se enteraba — había que refrescar a mano).
    // Broadcast GLOBAL (sin sala, ver socket.service.ts), mismo evento que ya consume
    // clientes-pendientes.component.ts — refresca la página actual preservando filtros/orden
    // (cargar() ya los usa todos, ver más abajo).
    this.socketService.lealtadClienteKoreActualizado$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.cargar();
    });
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

  // Color real de Kore en el chip de nivel (2026-11-17, pedido explícito del usuario) — reemplaza
  // los 3 modificadores CSS fijos (.tl-tier--bronce/plata/oro), que dejaban sin color cualquier
  // nivel nuevo no hardcodeado acá (Azul, Esmeralda, lo que Kore agregue después). Busca en
  // `nivelesCatalogo` (ya cargado por `_cargarNivelesCatalogo()`) por nombre; si el nivel no está
  // en catálogo o no tiene `color`, cae a un fallback neutro — el chip nunca debe quedar sin estilo.
  colorDeNivel(nombre: string): { background: string; color: string } {
    const nivel = this.nivelesCatalogo.find((n) => n.nombre === nombre);
    if (!nivel?.color) {
      return { background: '#e5e7eb', color: '#374151' };
    }
    return { background: nivel.color, color: this._colorTexto(nivel.color) };
  }

  // Luminancia relativa simple — misma fórmula EXACTA que tarjeta-detail.component.ts, para que
  // el criterio de contraste quede igual en ambas pantallas.
  private _colorTexto(hex: string): string {
    const h = hex.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#1f2937';
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminancia > 0.6 ? '#1f2937' : '#ffffff';
  }

  private _cargarNivelesCatalogo(): void {
    this.loyalty.listarNivelesKore(true).pipe(takeUntil(this.destroy$)).subscribe({
      next: (niveles) => { this.nivelesCatalogo = niveles; },
      error: (err) => {
        // No bloquea el resto de la pantalla — el filtro de nivel simplemente queda sin
        // opciones (la tabla de tarjetas se carga igual, ver cargar()).
        console.error('[TarjetasListComponent] No se pudo cargar el catálogo de niveles de Kore:', err);
      },
    });
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
}
