import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Modal de confirmación genérico (contabilizar/cancelar/revertir/guardar
 * filtros), originalmente extraído de poliza-list.component para que
 * poliza-traspasos lo reuse tal cual en vez de duplicar el mismo bloque de
 * estado+template, o depender de confirm()/prompt() nativos del navegador.
 * 2026-09-07: promovido de features/polizas a shared/components para que
 * report-panel (features/banks) también lo reuse sin duplicar el modal.
 * Presentacional puro — el padre sigue orquestando la llamada real vía el
 * callback que dispara (run).
 */
@Component({
  standalone: false,
  selector: 'app-confirm-modal',
  templateUrl: './confirm-modal.component.html',
})
export class ConfirmModalComponent {
  @Input() show = false;
  @Input() title = '';
  @Input() msg = '';
  @Input() btn = '';
  @Input() cls = '';

  @Input() showMotivo = false;
  @Input() motivo = '';
  @Output() motivoChange = new EventEmitter<string>();

  @Input() showRevertirCuentas = false;
  @Input() revertirCuentas = true;
  @Output() revertirCuentasChange = new EventEmitter<boolean>();

  @Output() run   = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();
}
