import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Muestra el NIP en texto plano UNA sola vez (alta o "Cambiar NIP" —
 * spec loyalty-cards "Previous NIP is never exposed", design.md D6).
 * Puramente presentacional: no guarda el NIP en ningún lado, el padre lo
 * descarta junto con este componente al cerrar (no hay forma de reabrirlo).
 */
@Component({
  standalone: false,
  selector: 'app-nip-reveal-modal',
  templateUrl: './nip-reveal-modal.component.html',
  styleUrls: ['./nip-reveal-modal.component.css'],
})
export class NipRevealModalComponent {
  @Input() nombre = '';
  @Input() nip = '';
  @Output() closed = new EventEmitter<void>();
}
