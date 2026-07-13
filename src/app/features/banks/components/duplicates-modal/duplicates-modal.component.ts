import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  BankService, DuplicatesResult, DuplicateMovementGroup, DuplicateCriterio,
} from '../../../../core/services/bank.service';

@Component({
  standalone: false,
  selector: 'app-duplicates-modal',
  templateUrl: './duplicates-modal.component.html',
  styleUrls: ['./duplicates-modal.component.css'],
})
export class DuplicatesModalComponent implements OnInit, OnDestroy {
  @Output() navigate = new EventEmitter<{ banco: string; movIds: string }>();
  @Output() closed   = new EventEmitter<void>();

  readonly PAGE_SIZE = 10;

  duplicatesLoading  = false;
  duplicatesResult: DuplicatesResult | null = null;
  duplicatesError: string | null = null;
  dupDeleteErrors: Record<string, string> = {};
  deletingDupIds   = new Set<string>();
  confirmingDupId: string | null = null;
  criterioFiltro: DuplicateCriterio | null = null;
  currentPage = 1;

  private destroy$ = new Subject<void>();

  constructor(private bankService: BankService) {}

  ngOnInit(): void { this.load(); }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.duplicatesLoading = true;
    this.duplicatesResult  = null;
    this.duplicatesError   = null;
    this.dupDeleteErrors   = {};
    this.confirmingDupId   = null;
    this.criterioFiltro    = null;
    this.deletingDupIds    = new Set();
    this.currentPage       = 1;

    this.bankService.findDuplicates()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  (res) => { this.duplicatesResult = res; this.duplicatesLoading = false; },
        error: (err) => {
          this.duplicatesError   = err?.error?.error || 'Error al buscar duplicados';
          this.duplicatesLoading = false;
        },
      });
  }

  // ── Getters de visualización ────────────────────────────────────────────────

  get subtitulo(): string {
    if (!this.duplicatesResult) return '';
    const n = this.duplicatesResult.total;
    if (n === 0) return 'No se encontraron grupos sospechosos';
    return `${n} grupo${n !== 1 ? 's' : ''} detectado${n !== 1 ? 's' : ''}`;
  }

  get gruposFiltrados(): DuplicateMovementGroup[] {
    if (!this.duplicatesResult) return [];
    if (!this.criterioFiltro)   return this.duplicatesResult.grupos;
    return this.duplicatesResult.grupos.filter(g => g.criterio === this.criterioFiltro);
  }

  get totalPages(): number {
    return Math.ceil(this.gruposFiltrados.length / this.PAGE_SIZE) || 1;
  }

  get gruposPaginados(): DuplicateMovementGroup[] {
    const start = (this.currentPage - 1) * this.PAGE_SIZE;
    return this.gruposFiltrados.slice(start, start + this.PAGE_SIZE);
  }

  get paginacionLabel(): string {
    const total = this.gruposFiltrados.length;
    if (total === 0) return '';
    const start = (this.currentPage - 1) * this.PAGE_SIZE + 1;
    const end   = Math.min(this.currentPage * this.PAGE_SIZE, total);
    return `${start}–${end} de ${total} grupo${total !== 1 ? 's' : ''}`;
  }

  criterioCount(criterio: DuplicateCriterio): number {
    return this.duplicatesResult?.grupos.filter(g => g.criterio === criterio).length ?? 0;
  }

  // ── Navegación ──────────────────────────────────────────────────────────────

  setCriterioFiltro(criterio: DuplicateCriterio | null): void {
    this.criterioFiltro  = criterio;
    this.confirmingDupId = null;
    this.currentPage     = 1;
  }

  prevPage(): void {
    if (this.currentPage > 1) { this.currentPage--; this.confirmingDupId = null; }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) { this.currentPage++; this.confirmingDupId = null; }
  }

  // ── Acciones ────────────────────────────────────────────────────────────────

  dupGroupMovIds(g: DuplicateMovementGroup): string {
    return g.movimientos.map(m => m._id).join(',');
  }

  navigateToDuplicateGroup(banco: string, movIds: string): void {
    this.navigate.emit({ banco, movIds });
  }

  confirmDelete(movId: string): void {
    if (this.deletingDupIds.has(movId)) return;
    if (this.dupDeleteErrors[movId]) {
      const updated = { ...this.dupDeleteErrors };
      delete updated[movId];
      this.dupDeleteErrors = updated;
    }
    this.confirmingDupId = movId;
  }

  cancelDelete(): void {
    this.confirmingDupId = null;
  }

  deleteDuplicate(movId: string, grupo: DuplicateMovementGroup): void {
    if (this.deletingDupIds.has(movId) || !this.duplicatesResult) return;
    this.confirmingDupId = null;
    this.deletingDupIds  = new Set([...this.deletingDupIds, movId]);

    this.bankService.deleteMovements([movId])
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          const gruposActualizados = this.duplicatesResult!.grupos
            .map(g => {
              if (g !== grupo) return g;
              const filtrados = g.movimientos.filter(m => m._id !== movId);
              return { ...g, movimientos: filtrados, count: filtrados.length };
            })
            .filter(g => g.movimientos.length >= 2);

          if (this.criterioFiltro && !gruposActualizados.some(g => g.criterio === this.criterioFiltro)) {
            this.criterioFiltro = null;
          }

          this.duplicatesResult = { total: gruposActualizados.length, grupos: gruposActualizados };
          this.deletingDupIds   = new Set([...this.deletingDupIds].filter(id => id !== movId));
          this.adjustPage();
        },
        error: (err) => {
          const msg = err?.error?.error || 'Error al eliminar el movimiento';
          this.dupDeleteErrors = { ...this.dupDeleteErrors, [movId]: msg };
          this.deletingDupIds  = new Set([...this.deletingDupIds].filter(id => id !== movId));
        },
      });
  }

  private adjustPage(): void {
    const max = Math.ceil(this.gruposFiltrados.length / this.PAGE_SIZE) || 1;
    if (this.currentPage > max) this.currentPage = max;
  }
}
