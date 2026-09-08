import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { NetpayConsultaResultado } from '../../../../core/models/netpay-transaccion.model';

@Component({
  standalone: false,
  selector: 'app-netpay-panel',
  templateUrl: './netpay-panel.component.html',
  styleUrls: ['./netpay-panel.component.css'],
})
export class NetpayPanelComponent implements OnChanges {
  @Input() visible = false;
  @Output() closed = new EventEmitter<void>();

  // Filtros manuales (Fase 1) — el usuario todavía está diseñando el resto del catálogo
  // de parámetros de Kore, por ahora solo estos 4.
  responseCode = '';
  almacenes    = '';
  // Bindeados a <app-date-range-popover> (2026-09-08: antes 2 <input type="date">
  // sueltos) — YYYY-MM-DD, se completan a inicio/fin de día en ISO (T00:00:00Z/
  // T23:59:59Z) recién al armar la consulta, ver buscar().
  dateFrom = '';
  dateTo   = '';

  resultado: NetpayConsultaResultado | null = null;
  loading = false;
  error: string | null = null;

  constructor(
    private bankService: BankService,
    public  auth:        AuthService,
  ) {}

  // Mismo criterio que transferencias-caja-panel: recargar SIEMPRE que el panel se
  // vuelve a mostrar, sin guardar estado cacheado de una apertura anterior — nunca un
  // guard tipo "if (!this.resultado)".
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) this._reset();
  }

  private _reset(): void {
    this.resultado = null;
    this.error     = null;
  }

  buscar(): void {
    this.loading = true;
    this.error   = null;
    this.bankService.consultarNetpayTransacciones(
      this.responseCode.trim() || undefined,
      this.almacenes.trim() || undefined,
      this.dateFrom ? `${this.dateFrom}T00:00:00Z` : undefined,
      this.dateTo ? `${this.dateTo}T23:59:59Z` : undefined,
    ).subscribe({
      next: (resultado) => { this.resultado = resultado; this.loading = false; },
      error: (err) => {
        this.error   = err?.error?.error || 'Error al consultar transacciones Netpay';
        this.loading = false;
      },
    });
  }

  cerrar(): void {
    this.closed.emit();
  }
}
