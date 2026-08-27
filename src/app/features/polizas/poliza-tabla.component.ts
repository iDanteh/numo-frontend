import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Poliza, PolizaTipo } from '../../core/services/poliza.service';

// Tabla + acciones + badge de estado, compartido entre PolizaListComponent (tab
// "polizas", Ingreso/Cobranza) y PolizaTraspasosComponent — la ÚNICA pieza
// genuinamente idéntica entre ambos flujos (ver decisión 2026-08-26: fusionar los
// 2 componentes completos se descartó por riesgo, poliza-list.component.ts tiene
// 3600+ líneas de lógica 100% específica de CFDI que Traspasos no usa ni necesita).
// Puramente presentacional — no llama servicios, solo pinta y emite eventos; cada
// padre sigue manejando su propia orquestación (llamadas a PolizaService, modales
// especiales, confirmaciones).
@Component({
  standalone: false,
  selector: 'app-poliza-tabla',
  templateUrl: './poliza-tabla.component.html',
})
export class PolizaTablaComponent {
  @Input() polizas: Poliza[] = [];

  // Columnas opcionales — solo Ingreso/Cobranza las usan hoy.
  @Input() mostrarTipo = false;
  @Input() mostrarCfdi = false;
  @Input() tipoLabel: (t: PolizaTipo) => string = (t) => t;
  @Input() cfdiTooltip: (s: NonNullable<Poliza['cfdiSummary']>) => string = () => '';

  // Acciones opcionales por fila.
  @Input() mostrarRevertir = false; // Ingreso/Cobranza: solo admin
  @Input() mostrarExportar = false; // Traspasos: exportar a CONTPAQ
  @Input() isAdmin = false;
  @Input() cancelando: Set<number> = new Set();
  @Input() exportando: Set<number> = new Set();

  @Output() rowClick    = new EventEmitter<Poliza>();
  @Output() contabilizar = new EventEmitter<Poliza>();
  @Output() revertir     = new EventEmitter<Poliza>();
  @Output() cancelar     = new EventEmitter<Poliza>();
  @Output() exportar     = new EventEmitter<Poliza>();

  trackById(_: number, p: Poliza): number | undefined { return p.id; }
}
