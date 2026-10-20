import { Component, EventEmitter, Output } from '@angular/core';
import { LoyaltyService, LoyaltyCrearTarjetaResult, LoyaltyNivel } from '../../../core/services/loyalty.service';
import { TELEFONO_RE } from '../lealtad.constants';

/**
 * "+ Nueva tarjeta" (loyalty:tarjetas:crear, gated by the parent list) —
 * teléfono de 10 dígitos es la única identidad (D1), el NIP lo genera el
 * servidor (nunca se teclea acá, D6). `nivel` por defecto Bronce, pero
 * spec loyalty-cards permite a staff fijarlo explícito al crear.
 */
@Component({
  standalone: false,
  selector: 'app-tarjeta-create-modal',
  templateUrl: './tarjeta-create-modal.component.html',
})
export class TarjetaCreateModalComponent {
  telefono = '';
  nombre = '';
  nivel: LoyaltyNivel = 'Bronce';
  saving = false;
  error = '';

  @Output() created = new EventEmitter<LoyaltyCrearTarjetaResult>();
  @Output() closed  = new EventEmitter<void>();

  constructor(private loyalty: LoyaltyService) {}

  guardar(): void {
    if (this.saving) return;
    const telefono = this.telefono.trim();
    const nombre   = this.nombre.trim();

    if (!TELEFONO_RE.test(telefono)) {
      this.error = 'El teléfono debe tener exactamente 10 dígitos.';
      return;
    }
    if (!nombre) {
      this.error = 'El nombre es obligatorio.';
      return;
    }

    this.error = '';
    this.saving = true;
    this.loyalty.crearTarjeta({ telefono, nombre, nivel: this.nivel }).subscribe({
      next: (result) => {
        this.saving = false;
        this.created.emit(result);
      },
      error: (err) => {
        this.saving = false;
        this.error = err?.error?.error || 'No se pudo crear la tarjeta.';
      },
    });
  }
}
