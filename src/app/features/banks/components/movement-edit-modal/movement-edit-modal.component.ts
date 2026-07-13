import { Component, OnInit, OnDestroy, Input, Output, EventEmitter } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BankService, BankMovement, UpdateMovementDto } from '../../../../core/services/bank.service';

@Component({
  standalone: false,
  selector: 'app-movement-edit-modal',
  templateUrl: './movement-edit-modal.component.html',
  styleUrls: ['./movement-edit-modal.component.css'],
})
export class MovementEditModalComponent implements OnInit, OnDestroy {
  @Input() movement!: BankMovement;

  @Output() saved  = new EventEmitter<BankMovement>();
  @Output() closed = new EventEmitter<void>();

  editForm: UpdateMovementDto = {};
  editSaving                  = false;
  editError: string | null    = null;
  categorias: string[]        = [];

  private destroy$ = new Subject<void>();

  constructor(private bankService: BankService) {}

  ngOnInit(): void {
    const mov = this.movement;
    this.editForm = {
      concepto:           mov.concepto           ?? '',
      fecha:              mov.fecha              ? mov.fecha.substring(0, 10) : '',
      deposito:           mov.deposito           ?? null,
      retiro:             mov.retiro             ?? null,
      saldo:              mov.saldo              ?? null,
      numeroAutorizacion: mov.numeroAutorizacion ?? '',
      referenciaNumerica: mov.referenciaNumerica ?? '',
      categoria:          mov.categoria          ?? '',
    };
    this.bankService.listCategories(mov.banco)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (cats) => { this.categorias = cats.filter((c): c is string => c !== null); } });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  canEditAmounts(mov: BankMovement): boolean {
    return (mov.erpLinks ?? []).length === 0;
  }

  saveEditModal(): void {
    if (this.editSaving) return;
    this.editSaving = true;
    this.editError  = null;

    const editAmounts = this.canEditAmounts(this.movement);
    const payload: UpdateMovementDto = {
      concepto:           (this.editForm.concepto as string)?.trim()           || null,
      fecha:              (this.editForm.fecha as string)                       || null,
      ...(editAmounts ? {
        deposito: this.editForm.deposito ?? null,
        retiro:   this.editForm.retiro   ?? null,
      } : {}),
      saldo:              this.editForm.saldo              ?? null,
      numeroAutorizacion: (this.editForm.numeroAutorizacion as string)?.trim() || null,
      referenciaNumerica: (this.editForm.referenciaNumerica as string)?.trim() || null,
      categoria:          (this.editForm.categoria as string)?.trim()          || null,
    };

    this.bankService.updateMovement(this.movement._id, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  (updated) => { this.editSaving = false; this.saved.emit({ ...this.movement, ...updated } as BankMovement); },
        error: (err)     => {
          this.editError  = err?.error?.error ?? 'Error al guardar los cambios';
          this.editSaving = false;
        },
      });
  }
}
