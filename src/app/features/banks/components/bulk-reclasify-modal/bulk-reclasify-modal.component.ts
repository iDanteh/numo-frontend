import { Component, Input, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';

export interface BulkReclasifyResult {
  mode: 'status' | 'categoria';
  count: number;
}

@Component({
  standalone: false,
  selector: 'app-bulk-reclasify-modal',
  templateUrl: './bulk-reclasify-modal.component.html',
  styleUrls: ['./bulk-reclasify-modal.component.css'],
})
export class BulkReclasifyModalComponent implements OnInit, OnDestroy {
  @Input() activeBanco!: string;
  @Input() ids!: string[];

  @Output() saved  = new EventEmitter<BulkReclasifyResult>();
  @Output() closed = new EventEmitter<void>();

  mode: 'status' | 'categoria' = 'status';
  categorias: string[] = [];
  categoriaSeleccionada = '';

  saving = false;
  error: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(private bankService: BankService, public auth: AuthService) {}

  ngOnInit(): void {
    this.bankService.listCategories(this.activeBanco)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (cats) => { this.categorias = cats.filter((c): c is string => c !== null); } });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get canUseCategoria(): boolean {
    return this.auth.hasPermission('banks:movement:categoria');
  }

  selectMode(m: 'status' | 'categoria'): void {
    if (m === 'categoria' && !this.canUseCategoria) return;
    this.mode  = m;
    this.error = null;
  }

  confirm(): void {
    if (this.saving || this.ids.length === 0) return;
    this.saving = true;
    this.error  = null;

    const req$: Observable<any> = this.mode === 'status'
      ? this.bankService.reclasifyMovements(this.ids)
      : this.bankService.bulkUpdateCategoria(this.ids, this.categoriaSeleccionada.trim() || null);

    req$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.saving = false;
        const count = this.mode === 'status' ? (res.reclasified ?? this.ids.length) : (res.actualizados ?? this.ids.length);
        this.saved.emit({ mode: this.mode, count });
      },
      error: (err: any) => {
        this.error  = err?.error?.error || 'Error al reclasificar';
        this.saving = false;
      },
    });
  }
}
