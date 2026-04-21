import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import {
  AccountPlanService,
  AccountPlan,
  AccountNode,
  ImportResult,
} from '../../core/services/account-plan.service';

type ModalMode = 'create' | 'edit';

@Component({
  standalone: false,
  selector: 'app-account-plan',
  templateUrl: './account-plan.component.html',
})
export class AccountPlanComponent implements OnInit, OnDestroy {

  // ── Árbol ──────────────────────────────────────────────────────────────────
  allAccounts:  AccountPlan[] = [];
  roots:        AccountNode[] = [];
  visibleNodes: AccountNode[] = [];
  loading       = false;

  // ── Filtros ────────────────────────────────────────────────────────────────
  searchTerm    = '';
  filterTipo    = '';

  // ── Modal de cuenta ────────────────────────────────────────────────────────
  showModal     = false;
  modalMode:    ModalMode = 'create';
  editingId:    number | null = null;
  saving        = false;
  modalError:   string | null = null;
  accountForm:  FormGroup;

  // ── Import Excel ───────────────────────────────────────────────────────────
  importing     = false;
  selectedFile: File | null = null;
  importResult: ImportResult | null = null;
  importError:  string | null = null;
  isDragging    = false;

  readonly tiposContables = ['ACTIVO', 'PASIVO', 'CAPITAL', 'INGRESO', 'GASTO'];

  private destroy$ = new Subject<void>();

  constructor(
    private svc: AccountPlanService,
    private fb:  FormBuilder,
  ) {
    this.accountForm = this.fb.group({
      codigo:   ['', [Validators.required, Validators.pattern(/^\d{1,10}$/)]],
      nombre:   ['', Validators.required],
      ctaMayor: [null],
    });
  }

  ngOnInit(): void {
    this.loadTree();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Carga y árbol ──────────────────────────────────────────────────────────
  loadTree(): void {
    this.loading = true;
    this.svc.tree().subscribe({
      next: (accounts) => {
        this.allAccounts = accounts;
        this.roots       = this.svc.buildTree(this.applyLocalFilter(accounts));
        this.refreshVisible();
        this.loading     = false;
      },
      error: () => { this.loading = false; },
    });
  }

  applyLocalFilter(accounts: AccountPlan[]): AccountPlan[] {
    let result = accounts;
    if (this.filterTipo) result = result.filter(a => a.tipo === this.filterTipo);
    if (this.searchTerm) {
      const t = this.searchTerm.toLowerCase();
      result = result.filter(a =>
        a.codigo.includes(t) || a.nombre.toLowerCase().includes(t),
      );
    }
    return result;
  }

  applyFilter(): void {
    this.roots = this.svc.buildTree(this.applyLocalFilter(this.allAccounts));
    this.refreshVisible();
  }

  clearFilter(): void {
    this.searchTerm = '';
    this.filterTipo = '';
    this.applyFilter();
  }

  hasActiveFilter(): boolean {
    return !!(this.searchTerm || this.filterTipo);
  }

  refreshVisible(): void {
    this.visibleNodes = this.svc.flattenTree(this.roots);
  }

  toggleNode(node: AccountNode): void {
    if (node.children.length === 0) return;
    node.expanded = !node.expanded;
    this.refreshVisible();
  }

  expandAll(): void {
    this.setExpanded(this.roots, true);
    this.refreshVisible();
  }

  collapseAll(): void {
    this.setExpanded(this.roots, false);
    this.refreshVisible();
  }

  private setExpanded(nodes: AccountNode[], val: boolean): void {
    nodes.forEach(n => { n.expanded = val; this.setExpanded(n.children, val); });
  }

  // ── Colores por tipo ───────────────────────────────────────────────────────
  tipoColor(tipo: string): string {
    const map: Record<string, string> = {
      ACTIVO:  'badge-tipo-activo',
      PASIVO:  'badge-tipo-pasivo',
      CAPITAL: 'badge-tipo-capital',
      INGRESO: 'badge-tipo-ingreso',
      GASTO:   'badge-tipo-gasto',
    };
    return map[tipo] || 'badge-secondary';
  }

  // ── Modal CRUD ─────────────────────────────────────────────────────────────
  openCreate(parent?: AccountNode): void {
    this.modalMode  = 'create';
    this.editingId  = null;
    this.modalError = null;
    this.accountForm.reset({
      codigo:   '',
      nombre:   '',
      ctaMayor: parent?.codigo || null,
    });
    this.accountForm.get('codigo')!.enable();
    this.showModal = true;
  }

  openEdit(account: AccountPlan): void {
    this.modalMode  = 'edit';
    this.editingId  = account.id;
    this.modalError = null;
    this.accountForm.patchValue({
      codigo:   account.codigo,
      nombre:   account.nombre,
      ctaMayor: account.ctaMayor,
    });
    this.accountForm.get('codigo')!.disable();
    this.showModal = true;
  }

  closeModal(): void {
    this.showModal = false;
    this.accountForm.get('codigo')!.enable();
  }

  saveAccount(): void {
    if (this.accountForm.invalid || this.saving) return;
    this.saving     = true;
    this.modalError = null;

    const value = this.accountForm.getRawValue();
    const payload: Partial<AccountPlan> = {
      codigo:   value.codigo,
      nombre:   value.nombre,
      ctaMayor: value.ctaMayor || null,
    };

    const obs = this.modalMode === 'create'
      ? this.svc.create(payload)
      : this.svc.update(this.editingId!, payload);

    obs.subscribe({
      next: () => {
        this.saving    = false;
        this.showModal = false;
        this.accountForm.get('codigo')!.enable();
        this.loadTree();
      },
      error: (err) => {
        this.saving     = false;
        this.modalError = err?.error?.error || 'Error al guardar la cuenta';
      },
    });
  }

  deactivate(account: AccountPlan): void {
    if (!confirm(`¿Desactivar la cuenta ${account.codigo} - ${account.nombre}?`)) return;
    this.svc.deactivate(account.id).subscribe({
      next: () => this.loadTree(),
    });
  }

  // ── Import Excel ───────────────────────────────────────────────────────────
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setImportFile(input.files?.[0] ?? null);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
    const file = event.dataTransfer?.files[0];
    if (file && /\.(xlsx|xls)$/i.test(file.name)) this.setImportFile(file);
  }

  onDragOver(event: DragEvent): void { event.preventDefault(); this.isDragging = true; }
  onDragLeave(): void { this.isDragging = false; }

  private setImportFile(file: File | null): void {
    this.selectedFile = file;
    this.importResult = null;
    this.importError  = null;
  }

  importExcel(): void {
    if (!this.selectedFile || this.importing) return;
    this.importing   = true;
    this.importError = null;

    this.svc.import(this.selectedFile).subscribe({
      next: (res) => {
        this.importResult = res;
        this.importing    = false;
        this.selectedFile = null;
        this.loadTree();
      },
      error: (err) => {
        this.importError = err?.error?.error || 'Error al importar el archivo';
        this.importing   = false;
      },
    });
  }

  // ── Helpers de árbol ───────────────────────────────────────────────────────
  getGuides(node: AccountNode): unknown[] {
    return Array.from({ length: node.nivel - 1 });
  }

  countByTipo(tipo: string): number {
    return this.allAccounts.filter(a => a.tipo === tipo).length;
  }

  totalCuentas(): number { return this.allAccounts.length; }
}
