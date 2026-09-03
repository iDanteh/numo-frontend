import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { BankService, BankMovement } from '../../../../core/services/bank.service';

@Component({
  standalone: false,
  selector: 'app-ficha-pendiente-panel',
  templateUrl: './ficha-pendiente-panel.component.html',
  styleUrls: ['./ficha-pendiente-panel.component.css'],
})
export class FichaPendientePanelComponent implements OnChanges {
  @Input() visible = false;
  @Output() closed = new EventEmitter<void>();
  // Emite el movimiento de la fila clickeada — el padre (BanksComponent) reusa su
  // openErpModal() ya existente para abrir el modal ERP, que ya trae la sección de ficha.
  @Output() abrirFicha = new EventEmitter<BankMovement>();

  total = 0;
  movimientos: BankMovement[] = [];
  loading = false;
  error: string | null = null;

  constructor(private bankService: BankService) {}

  // Mismo criterio que report-panel/rules-panel: recargar SIEMPRE que el panel se vuelve
  // a mostrar, sin chequear si ya hay datos cacheados (bug real ya corregido una vez en
  // transferencias-caja-panel — no repetirlo acá).
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) this._cargar();
  }

  private _cargar(): void {
    this.loading = true;
    this.error   = null;
    this.bankService.listarPendientesFicha().subscribe({
      next: (res) => {
        this.total        = res.total;
        this.movimientos  = res.movimientos;
        this.loading      = false;
      },
      error: (err) => {
        this.error   = err?.error?.error || 'Error al cargar los movimientos pendientes de ficha';
        this.loading = false;
      },
    });
  }

  recargar(): void {
    this._cargar();
  }

  cerrar(): void {
    this.closed.emit();
  }

  onCargarFicha(mov: BankMovement): void {
    this.abrirFicha.emit(mov);
  }
}
