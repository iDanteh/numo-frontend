import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BankService, DuplicatesResult, DuplicateMovementGroup } from '../../../../core/services/bank.service';

@Component({
  standalone: false,
  selector: 'app-duplicates-modal',
  templateUrl: './duplicates-modal.component.html',
  styleUrls: ['./duplicates-modal.component.css'],
})
export class DuplicatesModalComponent implements OnInit, OnDestroy {
  @Output() navigate = new EventEmitter<{ banco: string; movIds: string }>();
  @Output() closed   = new EventEmitter<void>();

  duplicatesLoading = false;
  duplicatesResult: DuplicatesResult | null = null;
  duplicatesError: string | null = null;
  dupDeleteError: string | null  = null;
  deletingDupIds = new Set<string>();

  private destroy$ = new Subject<void>();

  constructor(private bankService: BankService) {}

  ngOnInit(): void {
    this.duplicatesLoading = true;
    this.bankService.findDuplicates()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  (res) => { this.duplicatesResult = res; this.duplicatesLoading = false; },
        error: (err) => {
          this.duplicatesError  = err?.error?.error || 'Error al buscar duplicados';
          this.duplicatesLoading = false;
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  dupGroupMovIds(g: DuplicateMovementGroup): string {
    return g.movimientos.map(m => m._id).join(',');
  }

  navigateToDuplicateGroup(banco: string, movIds: string): void {
    this.navigate.emit({ banco, movIds });
  }

  deleteDuplicate(movId: string, grupoIdx: number): void {
    if (this.deletingDupIds.has(movId) || !this.duplicatesResult) return;
    this.dupDeleteError = null;

    this.deletingDupIds = new Set(this.deletingDupIds);
    this.deletingDupIds.add(movId);

    this.bankService.deleteMovements([movId])
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          const gruposActualizados = this.duplicatesResult!.grupos
            .map((g, idx) => {
              if (idx !== grupoIdx) return g;
              const movimientosFiltrados = g.movimientos.filter(m => m._id !== movId);
              return { ...g, movimientos: movimientosFiltrados, count: movimientosFiltrados.length };
            })
            .filter(g => g.movimientos.length >= 2);

          this.duplicatesResult = { total: gruposActualizados.length, grupos: gruposActualizados };
          this.deletingDupIds = new Set(this.deletingDupIds);
          this.deletingDupIds.delete(movId);
        },
        error: (err) => {
          this.dupDeleteError = err?.error?.error || 'Error al eliminar el movimiento';
          this.deletingDupIds = new Set(this.deletingDupIds);
          this.deletingDupIds.delete(movId);
        },
      });
  }
}
