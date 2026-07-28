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
  categoriaFiltro = '';
  /** null = "Sin categoría" elegida explícitamente; undefined = todavía no se eligió nada. */
  categoriaSeleccionada: string | null | undefined = undefined;

  saving = false;
  error: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(private bankService: BankService, public auth: AuthService) {}

  ngOnInit(): void {
    this.bankService.listCategories(this.activeBanco)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (cats) => { this.categorias = cats.filter((c): c is string => c !== null); } });

    // El toolbar ya solo deja llegar hasta acá a quien tiene banks:movement:categoria — pero
    // "Por estatus" pega contra /movements/reclasify, que en el backend exige banks:config
    // (permiso distinto). Si a este usuario le falta banks:config, arranca en "categoria" en
    // vez de en el modo que no puede usar.
    if (!this.canUseStatus && this.canUseCategoria) this.mode = 'categoria';
  }

  get categoriasFiltradas(): string[] {
    const q = this.categoriaFiltro.trim().toLowerCase();
    return q ? this.categorias.filter(c => c.toLowerCase().includes(q)) : this.categorias;
  }

  selectCategoria(cat: string | null): void {
    this.categoriaSeleccionada = cat;
  }

  /** En modo categoría, hay que elegir algo de la lista antes de poder confirmar
   *  (incluso "Sin categoría" cuenta como elección explícita) — evita que un click
   *  accidental en "Confirmar" borre la categoría de todo lo seleccionado. En modo
   *  estatus, además de estar seleccionado el modo hace falta el permiso banks:config
   *  (backend real de /movements/reclasify) — sin él, "status" nunca es confirmable. */
  get canConfirm(): boolean {
    if (this.mode === 'status') return this.canUseStatus;
    return this.categoriaSeleccionada !== undefined;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // "Por estatus" pega contra /movements/reclasify (banks:config) — permiso DISTINTO al que
  // deja llegar hasta este modal (banks:movement:categoria, ver el toolbar en
  // banks.component.html). Alguien con solo banks:movement:categoria puede abrir el modal
  // pero no usar este modo — solo "Por categoría".
  get canUseStatus(): boolean {
    return this.auth.hasPermission('banks:config');
  }

  get canUseCategoria(): boolean {
    return this.auth.hasPermission('banks:movement:categoria');
  }

  selectMode(m: 'status' | 'categoria'): void {
    if (m === 'status'    && !this.canUseStatus)    return;
    if (m === 'categoria' && !this.canUseCategoria) return;
    this.mode  = m;
    this.error = null;
  }

  confirm(): void {
    if (this.saving || this.ids.length === 0 || !this.canConfirm) return;
    this.saving = true;
    this.error  = null;

    const req$: Observable<any> = this.mode === 'status'
      ? this.bankService.reclasifyMovements(this.ids)
      : this.bankService.bulkUpdateCategoria(this.ids, this.categoriaSeleccionada ?? null);

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
