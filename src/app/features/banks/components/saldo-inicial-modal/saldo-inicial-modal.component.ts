import { Component, Input, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BankService } from '../../../../core/services/bank.service';

export interface SaldoInicialResult {
  saldoInicial: number;
  saldoInicialFechaCorte: string | null;
}

@Component({
  standalone: false,
  selector: 'app-saldo-inicial-modal',
  templateUrl: './saldo-inicial-modal.component.html',
  styleUrls: ['./saldo-inicial-modal.component.css'],
})
export class SaldoInicialModalComponent implements OnDestroy {
  @Input() activeBanco!: string | null;
  @Output() saved  = new EventEmitter<SaldoInicialResult>();
  @Output() closed = new EventEmitter<void>();

  saldoInicialInput: number | null = null;
  showConfirm       = false;
  saving            = false;
  error: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(private bankService: BankService) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  requestConfirm(): void {
    if (this.saldoInicialInput == null || isNaN(this.saldoInicialInput)) {
      this.error = 'Ingresa un monto válido';
      return;
    }
    this.error       = null;
    this.showConfirm = true;
  }

  confirm(): void {
    if (!this.activeBanco || this.saving) return;
    const monto  = this.saldoInicialInput ?? 0;
    this.saving  = true;
    this.error   = null;
    this.bankService.setSaldoInicial(this.activeBanco, monto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.saving = false;
          this.saved.emit({ saldoInicial: res.saldoInicial, saldoInicialFechaCorte: res.saldoInicialFechaCorte });
        },
        error: (err) => {
          this.error       = err?.error?.error || 'Error al registrar el saldo inicial';
          this.saving      = false;
          this.showConfirm = false;
        },
      });
  }
}
