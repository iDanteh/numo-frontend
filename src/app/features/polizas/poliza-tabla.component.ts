import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Poliza, PolizaTipo, FacturasTardiasMap, SinTimbrarPorPolizaMap } from '../../core/services/poliza.service';

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
  // Ingreso: "↻ Actualizar" (regenerar borrador con facturas que llegaron después).
  @Input() mostrarActualizar = false;
  @Input() actualizando: Set<number> = new Set();
  // Aviso "faltan CFDIs": facturas que llegaron después de generar la póliza.
  @Input() tardias: FacturasTardiasMap = {};
  // "⏳ N sin timbrar": facturas de Kore de su sucursal y día aún sin timbrar.
  @Input() sinTimbrar: SinTimbrarPorPolizaMap = {};
  @Output() verSinTimbrar = new EventEmitter<Poliza>();

  // "↻ Actualizar": Ingreso, y Cobranza desde 2026-11-12 (tipo 'D' generada por
  // día, concepto "Ingresos por Cobranza del Día: …"), solo en borrador.
  puedeActualizar(p: Poliza): boolean {
    if (p.estado !== 'borrador') return false;
    return p.tipo === 'I' || (p.tipo === 'D' && /^Ingresos por Cobranza del Día: /.test(p.concepto || ''));
  }

  sinTimbrarTooltip(id: number | undefined): string {
    const s = id != null ? this.sinTimbrar[id] : undefined;
    if (!s) return '';
    const lista = s.facturas.slice(0, 15).map(f => `${f.serieFolio}${f.tipo === 'E' ? ' (NC)' : ''}`).join(', ');
    const mas = s.facturas.length > 15 ? ` y ${s.facturas.length - 15} más` : '';
    return `${s.total} factura(s) de este día ya están en Kore pero aún no se timbran: ${lista}${mas}. Cuando se timbren le faltarán a esta póliza. Clic para ver el detalle.`;
  }

  tardiasTooltip(id: number | undefined): string {
    const t = id != null ? this.tardias[id] : undefined;
    if (!t) return '';
    const lista = t.facturas.slice(0, 15).map(f => `${f.serieFolio || f.uuid.slice(0, 8)}${f.tipo === 'E' ? ' (NC)' : ''}`).join(', ');
    const mas = t.facturas.length > 15 ? ` y ${t.facturas.length - 15} más` : '';
    return `Faltan ${t.total} CFDI(s) que llegaron del SAT después de generar esta póliza: ${lista}${mas}. Dale ↻ Actualizar para incluirlos.`;
  }

  @Output() rowClick    = new EventEmitter<Poliza>();
  @Output() contabilizar = new EventEmitter<Poliza>();
  @Output() revertir     = new EventEmitter<Poliza>();
  @Output() cancelar     = new EventEmitter<Poliza>();
  @Output() exportar     = new EventEmitter<Poliza>();
  @Output() actualizar   = new EventEmitter<Poliza>();

  trackById(_: number, p: Poliza): number | undefined { return p.id; }
}
