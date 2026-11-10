import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import * as XLSX from 'xlsx';
import { PolizaService, SinTimbrarResult, FacturaSinTimbrar, FiltroSinTimbrar } from '../../core/services/poliza.service';
import { CentroCosto } from '../../core/services/centros-costo.service';
import { ToastService } from '../../core/services/toast.service';

// Pólizas › "Sin timbrar" (2026-11-09): facturas/NC que ya existen en Kore pero
// todavía no se timbran en el SAT — llegarán tarde a la póliza de Ingreso del
// día (caso CEDIS, reporte "NO REGISTRADOS COMPAQ"). Solo activas en Kore.
@Component({
  standalone: false,
  selector: 'app-poliza-sin-timbrar',
  templateUrl: './poliza-sin-timbrar.component.html',
})
export class PolizaSinTimbrarComponent implements OnChanges {
  @Input() rfc?: string;
  @Input() centrosCosto: CentroCosto[] = [];
  @Input() ejercicio?: number;
  @Input() periodo?: number;
  // Filtro que llega al dar clic en "⏳ N sin timbrar" de una póliza (su sucursal y día).
  @Input() filtro: FiltroSinTimbrar | null = null;

  desde = '';
  hasta = '';
  centroCostoId: number | '' = '';
  cargando = false;
  res: SinTimbrarResult | null = null;
  error: string | null = null;

  constructor(private svc: PolizaService, private toast: ToastService) {}

  ngOnChanges(ch: SimpleChanges): void {
    if (this.filtro && (ch['filtro'] || !this.desde)) {
      this.desde = this.filtro.desde;
      this.hasta = this.filtro.hasta;
      this.centroCostoId = this.filtro.centroCostoId ?? '';
      if (this.rfc) this.buscar();
      return;
    }
    if (ch['ejercicio'] || ch['periodo'] || !this.desde) this.rangoPorDefecto();
    if (this.rfc && (ch['rfc'] || ch['ejercicio'] || ch['periodo'])) this.buscar();
  }

  // Del día 1 del periodo activo a hoy (o al fin del mes si el periodo ya pasó).
  private rangoPorDefecto(): void {
    const hoy = this.hoyMx();
    if (!this.ejercicio || !this.periodo) { this.desde = hoy.slice(0, 8) + '01'; this.hasta = hoy; return; }
    const mm = String(this.periodo).padStart(2, '0');
    this.desde = `${this.ejercicio}-${mm}-01`;
    const ultimo = new Date(Date.UTC(this.ejercicio, this.periodo, 0)).toISOString().slice(0, 10);
    this.hasta = ultimo < hoy ? ultimo : hoy;
  }

  private hoyMx(): string {
    return new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
  }

  buscar(): void {
    if (!this.rfc || !this.desde || !this.hasta) return;
    this.cargando = true;
    this.error = null;
    this.svc.sinTimbrar({
      rfc: this.rfc, desde: this.desde, hasta: this.hasta,
      centroCostoId: this.centroCostoId === '' ? undefined : Number(this.centroCostoId),
    }).subscribe({
      next: (r) => { this.res = r; this.cargando = false; },
      error: (err) => {
        this.cargando = false;
        this.res = null;
        this.error = err?.error?.error || 'Error al consultar facturas sin timbrar';
      },
    });
  }

  fmtDia(ymd: string): string {
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
  }

  trackFolio(_: number, f: FacturaSinTimbrar): string { return f.serieFolio; }

  exportar(): void {
    if (!this.res?.facturas.length) return;
    const filas = this.res.facturas.map(f => ({
      'Folio': f.serieFolio,
      'Día': this.fmtDia(f.dia),
      'Días sin timbrar': f.diasSinTimbrar,
      'Tipo': f.tipo === 'E' ? 'Nota de crédito' : 'Factura',
      'Pago': f.metodoPago ?? '',
      'Forma': f.formaPago ?? '',
      'Subtotal': f.subTotal,
      'Total': f.total,
      'Cliente': f.cliente ?? '',
      'RFC cliente': f.rfcCliente ?? '',
      'Sucursal': f.sucursal ?? '',
      'Póliza del día': f.polizaNumero != null ? `I-${f.polizaNumero} (${f.polizaEstado})` : 'Sin póliza',
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sin timbrar');
    XLSX.writeFile(wb, `Sin_timbrar_${this.desde}_a_${this.hasta}.xlsx`);
    this.toast.success('Excel descargado');
  }
}
