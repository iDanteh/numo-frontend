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

  // Copiar al portapapeles (2026-10-19): este dato se transcribe a mano una
  // sola vez — copiarlo reduce el riesgo de error de transcripción. El check
  // momentáneo confirma la copia sin necesitar un toast aparte.
  copiado = false;
  private copiadoTimeout: ReturnType<typeof setTimeout> | null = null;

  copiarNip(): void {
    navigator.clipboard?.writeText(this.nip).then(() => {
      this.copiado = true;
      if (this.copiadoTimeout) clearTimeout(this.copiadoTimeout);
      this.copiadoTimeout = setTimeout(() => { this.copiado = false; }, 1500);
    }).catch(() => { /* portapapeles no disponible — el NIP sigue visible para anotarlo a mano */ });
  }
}
