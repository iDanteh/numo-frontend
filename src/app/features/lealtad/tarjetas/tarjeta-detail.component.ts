import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/**
 * Placeholder (PR5, frontend shell) — detalle/ledger/historial reales
 * llegan en PR6 (Phase 6 de tasks.md).
 */
@Component({
  standalone: false,
  selector: 'app-tarjeta-detail',
  templateUrl: './tarjeta-detail.component.html',
})
export class TarjetaDetailComponent {
  readonly id: string | null;

  constructor(route: ActivatedRoute) {
    this.id = route.snapshot.paramMap.get('id');
  }
}
