import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { LoyaltyService, LoyaltyKoreVentaRetiroConDeposito } from '../../../core/services/loyalty.service';

/**
 * Bandeja de SOLO LECTURA (auditoría) — reversiones de puntos de Lealtad por retiros de ventas de
 * Kore que SÍ estaban relacionadas con un depósito bancario real. A diferencia de
 * ventas-fallidas.component.ts (bandeja de triage con "Marcar como resuelto"), acá no hay ninguna
 * acción: el backend (GET /loyalty/kore/ventas-retiradas-con-deposito, mismo permiso
 * loyalty:config) ya filtra solo las reversiones con depósito detrás — si no había depósito
 * relacionado, esas reversiones ni siquiera aparecen acá. Es pura visibilidad para que el equipo
 * de Bancos pueda mirarlas del otro lado si hace falta.
 */
@Component({
  standalone: false,
  selector: 'app-retiros-auditoria-lealtad',
  templateUrl: './retiros-auditoria.component.html',
  styleUrls: ['./retiros-auditoria.component.css'],
})
export class RetirosAuditoriaLealtadComponent implements OnInit, OnDestroy {
  ventas: LoyaltyKoreVentaRetiroConDeposito[] = [];
  loading = false;
  error = '';

  private destroy$ = new Subject<void>();

  constructor(private loyalty: LoyaltyService, private router: Router) {}

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
    this.loyalty.listarVentasRetiradasConDeposito().pipe(takeUntil(this.destroy$)).subscribe({
      next: (ventas) => {
        this.ventas = ventas;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'No se pudieron cargar los retiros con depósito.';
      },
    });
  }

  /** Mismo patrón programático que TarjetasListComponent.verDetalle() (router.navigate en vez de
   *  routerLink) — la fila completa de tarjeta es clickeable, no solo un link de texto. */
  verTarjeta(venta: LoyaltyKoreVentaRetiroConDeposito): void {
    if (!venta.cardId) return; // tarjeta ya no existe / card.id no vino en la respuesta
    this.router.navigate(['/lealtad/tarjetas', venta.cardId]);
  }
}
