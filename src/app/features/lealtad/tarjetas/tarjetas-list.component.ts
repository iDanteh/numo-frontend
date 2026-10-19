import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoyaltyService, LoyaltyCard, LoyaltyNivel, LoyaltyCrearTarjetaResult } from '../../../core/services/loyalty.service';
import { AuthService } from '../../../core/services/auth.service';
import { NIP_ERROR_FALLBACK, escapeHtml } from '../lealtad.constants';

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

  // Cambiar NIP rápido desde la lista — mismo flujo/endpoint que
  // tarjeta-detail.component.ts cambiarNip()/canCambiarNip() (POST
  // /cards/:id/nip usa LOYALTY_TARJETAS_EDITAR), con su propio campo de
  // revelado para no colisionar con nipRecienCreado (flujo de alta).
  nipCambiado: { nombre: string; nip: string } | null = null;
  confirmNipCard: LoyaltyCard | null = null;
  nipCambiandoId: number | null = null;
  nipError = '';

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

  // Idéntico a tarjeta-detail.component.ts#canCambiarNip() (ahí definido como
  // canEditar(), mismo permiso que editarTarjeta, D6) — duplicado aquí porque
  // tarjeta-detail.component.ts no se toca en este cambio.
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
      page: this.page,
      limit: this.limit,
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

  // Pide confirmación antes de invalidar el NIP anterior (irreversible) —
  // la fila ya navega al detalle con (click), por eso el handler del botón
  // en el template llama $event.stopPropagation().
  pedirCambiarNip(card: LoyaltyCard): void {
    this.confirmNipCard = card;
  }

  cerrarConfirmNip(): void {
    this.confirmNipCard = null;
  }

  // confirm-modal bindea [msg] con [innerHTML] — nombre es texto libre (viene
  // de alta manual o importación CSV), hay que escaparlo antes de concatenar
  // el <strong> o un nombre como "<a href=...>" se renderizaría como markup.
  get confirmNipMsg(): string {
    if (!this.confirmNipCard) return '';
    const nombreSeguro = escapeHtml(this.confirmNipCard.nombre);
    return `¿Generar un NIP nuevo para <strong>${nombreSeguro}</strong>? El NIP anterior dejará de funcionar y no se puede recuperar.`;
  }

  // Mismo endpoint/mecanismo de revelado que tarjeta-detail.component.ts
  // cambiarNip().
  confirmarCambiarNip(): void {
    const card = this.confirmNipCard;
    if (!card) return;
    this.confirmNipCard = null;
    this.nipCambiandoId = card.id;
    this.nipError = '';
    this.loyalty.cambiarNip(card.id).subscribe({
      next: (res) => {
        this.nipCambiandoId = null;
        this.nipCambiado = { nombre: card.nombre, nip: res.nip };
      },
      error: (err) => {
        this.nipCambiandoId = null;
        this.nipError = err?.error?.error || NIP_ERROR_FALLBACK;
      },
    });
  }

  cerrarNipCambiado(): void {
    this.nipCambiado = null;
  }
}
