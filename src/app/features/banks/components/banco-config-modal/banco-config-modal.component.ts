import { Component, Input, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BankService, BankCard } from '../../../../core/services/bank.service';

export interface BancoConfigResult {
  cuentaContable: string | null;
  numeroCuenta:   string | null;
}

@Component({
  standalone: false,
  selector: 'app-banco-config-modal',
  templateUrl: './banco-config-modal.component.html',
  styleUrls: ['./banco-config-modal.component.css'],
})
export class BancoConfigModalComponent implements OnInit, OnDestroy {
  @Input() card!: BankCard;
  @Output() saved  = new EventEmitter<BancoConfigResult>();
  @Output() closed = new EventEmitter<void>();

  cuentaInput       = '';
  numeroCuentaInput = '';
  saving            = false;

  private destroy$ = new Subject<void>();

  constructor(private bankService: BankService) {}

  ngOnInit(): void {
    this.cuentaInput       = this.card.cuentaContable || '';
    this.numeroCuentaInput = this.card.numeroCuenta   || '';
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  save(): void {
    if (this.saving) return;
    this.saving = true;
    this.bankService.saveBankConfig(this.card.banco, {
      cuentaContable: this.cuentaInput       || null as any,
      numeroCuenta:   this.numeroCuentaInput || null as any,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (cfg) => {
        this.saving = false;
        this.saved.emit({ cuentaContable: cfg.cuentaContable, numeroCuenta: cfg.numeroCuenta });
      },
      error: () => { this.saving = false; },
    });
  }
}
