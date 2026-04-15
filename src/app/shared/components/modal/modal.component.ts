import {
  Component, Input, Output, EventEmitter, HostListener, ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * ModalComponent — Modal reutilizable con backdrop, cierre por ESC y clic fuera.
 *
 * Uso:
 *   <app-modal title="Título" size="lg" (close)="onClose()">
 *     <!-- Contenido del body -->
 *     <div>...</div>
 *     <!-- Footer (proyección con selector) -->
 *     <div modal-footer>
 *       <button (click)="onClose()">Cancelar</button>
 *       <button (click)="save()">Guardar</button>
 *     </div>
 *   </app-modal>
 *
 * Tamaños: 'sm' (420px) | 'md' (580px) | 'lg' (780px) | 'xl' (1040px)
 */
@Component({
  standalone: false,
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="onBackdropClick($event)">
      <div class="modal-box" [ngClass]="'modal-' + size">

        <div class="modal-header">
          <h3 class="modal-title">{{ title }}</h3>
          <button class="modal-close-btn" type="button" (click)="close.emit()" aria-label="Cerrar">
            &times;
          </button>
        </div>

        <div class="modal-body">
          <ng-content></ng-content>
        </div>

        <div class="modal-footer">
          <ng-content select="[modal-footer]"></ng-content>
        </div>

      </div>
    </div>
  `,
})
export class ModalComponent {
  @Input() title = '';
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Output() close = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void { this.close.emit(); }

  onBackdropClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.close.emit();
    }
  }
}
