import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoyaltyService, LoyaltyCard, LoyaltyNivel, LoyaltyCrearTarjetaResult } from '../../../core/services/loyalty.service';
import { AuthService } from '../../../core/services/auth.service';

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
export class TarjetasListComponent implements OnInit {
  cards: LoyaltyCard[] = [];
  loading = false;
  error = '';

  search = '';
  nivelFiltro: LoyaltyNivel | '' = '';
  activaFiltro: '' | 'true' | 'false' = '';

  page = 1;
  totalPaginas = 1;
  readonly limit = 20;

  showCreateModal = false;
  nipRecienCreado: { nombre: string; nip: string } | null = null;

  constructor(
    private loyalty: LoyaltyService,
    public auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  canCrear(): boolean {
    return this.auth.hasPermission('loyalty:tarjetas:crear');
  }

  cargar(): void {
    this.loading = true;
    this.error = '';
    this.loyalty.listar({
      search: this.search.trim() || undefined,
      nivel: this.nivelFiltro || undefined,
      activa: this.activaFiltro === '' ? undefined : this.activaFiltro === 'true',
      page: this.page,
      limit: this.limit,
    }).subscribe({
      next: (res) => {
        this.cards = res.data;
        this.totalPaginas = res.pagination.totalPaginas;
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
    this.nipRecienCreado = { nombre: result.card.nombre, nip: result.nip };
    this.cargar();
  }

  cerrarNipReveal(): void {
    this.nipRecienCreado = null;
  }
}
