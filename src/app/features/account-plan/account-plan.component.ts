import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import {
  AccountPlanService,
  AccountPlan,
  AccountNode,
  ImportResult,
} from '../../core/services/account-plan.service';
import { CentrosCostoService, CentroCosto } from '../../core/services/centros-costo.service';
import { ClientesCatalogoService, ClienteCatalogo, ClienteImportResult } from '../../core/services/clientes-catalogo.service';
import { ToastService } from '../../core/services/toast.service';

type ModalMode = 'create' | 'edit';
type ActiveTab = 'cuentas' | 'centros' | 'clientes';

@Component({
  standalone: false,
  selector: 'app-account-plan',
  templateUrl: './account-plan.component.html',
})
export class AccountPlanComponent implements OnInit, OnDestroy {

  // ── Tabs ───────────────────────────────────────────────────────────────────
  activeTab: ActiveTab = 'cuentas';

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

  // ── Centros de Costo ───────────────────────────────────────────────────────
  centros:         CentroCosto[] = [];
  loadingCentros   = false;
  showCcModal      = false;
  ccModalMode:     ModalMode = 'create';
  ccEditingId:     number | null = null;
  savingCc         = false;
  ccModalError:    string | null = null;
  ccForm:          FormGroup;

  // ── Catálogo de Clientes ───────────────────────────────────────────────────
  clientes:              ClienteCatalogo[] = [];
  loadingClientes        = false;
  clienteSearch          = '';
  showClienteModal       = false;
  clienteModalMode:      ModalMode = 'create';
  clienteEditingId:      number | null = null;
  savingCliente          = false;
  clienteModalError:     string | null = null;
  clienteForm:           FormGroup;

  // Import clientes
  importingClientes      = false;
  clienteImportResult:   ClienteImportResult | null = null;
  clienteImportError:    string | null = null;

  readonly tiposCliente = ['CLIENTE', 'PROVEEDOR', 'CLIENTE-PROVEEDOR'];

  private destroy$ = new Subject<void>();

  constructor(
    private svc:          AccountPlanService,
    private centrosSvc:   CentrosCostoService,
    private clientesSvc:  ClientesCatalogoService,
    private fb:           FormBuilder,
    private toast:        ToastService,
  ) {
    this.accountForm = this.fb.group({
      codigo:   ['', [Validators.required, Validators.pattern(/^\d{1,10}$/)]],
      nombre:   ['', Validators.required],
      ctaMayor: [null],
    });
    this.ccForm = this.fb.group({
      clave:            ['', Validators.required],
      sucursal:         ['', Validators.required],
      serieFacturacion: [null],
    });
    this.clienteForm = this.fb.group({
      cuenta: ['', Validators.required],
      nombre: ['', Validators.required],
      tipo:   ['CLIENTE', Validators.required],
      rfc:    ['', [Validators.required, Validators.pattern(/^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/i)]],
    });
  }

  ngOnInit(): void {
    this.loadTree();
  }

  setTab(tab: ActiveTab): void {
    this.activeTab = tab;
    if (tab === 'centros'  && this.centros.length  === 0) this.loadCentros();
    if (tab === 'clientes' && this.clientes.length === 0) this.loadClientes();
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
      // IDs que coinciden directamente con la búsqueda
      const matchedIds = new Set(
        result.filter(a => a.codigo.toLowerCase().includes(t) || a.nombre.toLowerCase().includes(t)).map(a => a.id),
      );
      // Incluir todos los ancestros de las cuentas que coinciden para no romper la jerarquía
      const byId = new Map(result.map(a => [a.id, a]));
      const toInclude = new Set(matchedIds);
      for (const id of matchedIds) {
        let current = byId.get(id);
        while (current?.parentId != null && !toInclude.has(current.parentId)) {
          toInclude.add(current.parentId);
          current = byId.get(current.parentId);
        }
      }
      result = result.filter(a => toInclude.has(a.id));
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
      next: () => {
        this.toast.success(`Cuenta ${account.codigo} desactivada`);
        this.loadTree();
      },
      error: (err) => {
        this.toast.error(err?.error?.error || `No se pudo desactivar la cuenta ${account.codigo}`);
      },
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
    this.importExcel();
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

  // ── Centros de Costo CRUD ──────────────────────────────────────────────────
  loadCentros(): void {
    this.loadingCentros = true;
    this.centrosSvc.list().subscribe({
      next:  (data) => { this.centros = data; this.loadingCentros = false; },
      error: () => { this.loadingCentros = false; },
    });
  }

  openCcCreate(): void {
    this.ccModalMode  = 'create';
    this.ccEditingId  = null;
    this.ccModalError = null;
    this.ccForm.reset({ clave: '', sucursal: '', serieFacturacion: null });
    this.ccForm.get('clave')!.enable();
    this.showCcModal = true;
  }

  openCcEdit(cc: CentroCosto): void {
    this.ccModalMode  = 'edit';
    this.ccEditingId  = cc.id;
    this.ccModalError = null;
    this.ccForm.patchValue({ clave: cc.clave, sucursal: cc.sucursal, serieFacturacion: cc.serieFacturacion });
    this.ccForm.get('clave')!.disable();
    this.showCcModal = true;
  }

  closeCcModal(): void {
    this.showCcModal = false;
    this.ccForm.get('clave')!.enable();
  }

  saveCc(): void {
    if (this.ccForm.invalid || this.savingCc) return;
    this.savingCc    = true;
    this.ccModalError = null;

    const payload = this.ccForm.getRawValue();
    const obs = this.ccModalMode === 'create'
      ? this.centrosSvc.create(payload)
      : this.centrosSvc.update(this.ccEditingId!, payload);

    obs.subscribe({
      next: () => {
        this.savingCc    = false;
        this.showCcModal = false;
        this.ccForm.get('clave')!.enable();
        this.loadCentros();
        this.toast.success(this.ccModalMode === 'create' ? 'Centro de costo creado' : 'Centro de costo actualizado');
      },
      error: (err) => {
        this.savingCc    = false;
        this.ccModalError = err?.error?.error || 'Error al guardar';
      },
    });
  }

  deleteCc(cc: CentroCosto): void {
    if (!confirm(`¿Desactivar el centro de costo "${cc.clave} — ${cc.sucursal}"?`)) return;
    this.centrosSvc.delete(cc.id).subscribe({
      next:  () => { this.toast.success(`Centro "${cc.clave}" desactivado`); this.loadCentros(); },
      error: (err) => { this.toast.error(err?.error?.error || 'No se pudo desactivar'); },
    });
  }

  // ── Catálogo de Clientes CRUD ──────────────────────────────────────────────
  loadClientes(): void {
    this.loadingClientes = true;
    this.clientesSvc.list({ search: this.clienteSearch || undefined }).subscribe({
      next:  (data) => { this.clientes = data; this.loadingClientes = false; },
      error: () => { this.loadingClientes = false; },
    });
  }

  buscarClientes(): void { this.loadClientes(); }
  limpiarBusquedaClientes(): void { this.clienteSearch = ''; this.loadClientes(); }

  openClienteCreate(): void {
    this.clienteModalMode  = 'create';
    this.clienteEditingId  = null;
    this.clienteModalError = null;
    this.clienteForm.reset({ cuenta: '', nombre: '', tipo: 'CLIENTE', rfc: '' });
    this.clienteForm.get('rfc')!.enable();
    this.showClienteModal = true;
  }

  openClienteEdit(c: ClienteCatalogo): void {
    this.clienteModalMode  = 'edit';
    this.clienteEditingId  = c.id;
    this.clienteModalError = null;
    this.clienteForm.patchValue({ cuenta: c.cuenta, nombre: c.nombre, tipo: c.tipo, rfc: c.rfc });
    this.clienteForm.get('rfc')!.disable();
    this.showClienteModal = true;
  }

  closeClienteModal(): void {
    this.showClienteModal = false;
    this.clienteForm.get('rfc')!.enable();
  }

  saveCliente(): void {
    if (this.clienteForm.invalid || this.savingCliente) return;
    this.savingCliente    = true;
    this.clienteModalError = null;

    const payload = this.clienteForm.getRawValue();
    const obs = this.clienteModalMode === 'create'
      ? this.clientesSvc.create(payload)
      : this.clientesSvc.update(this.clienteEditingId!, payload);

    obs.subscribe({
      next: () => {
        this.savingCliente    = false;
        this.showClienteModal = false;
        this.clienteForm.get('rfc')!.enable();
        this.loadClientes();
        this.toast.success(this.clienteModalMode === 'create' ? 'Cliente creado' : 'Cliente actualizado');
      },
      error: (err) => {
        this.savingCliente    = false;
        this.clienteModalError = err?.error?.error || 'Error al guardar';
      },
    });
  }

  deleteCliente(c: ClienteCatalogo): void {
    if (!confirm(`¿Desactivar el cliente "${c.nombre}" (${c.rfc})?`)) return;
    this.clientesSvc.delete(c.id).subscribe({
      next:  () => { this.toast.success(`Cliente "${c.nombre}" desactivado`); this.loadClientes(); },
      error: (err) => { this.toast.error(err?.error?.error || 'No se pudo desactivar'); },
    });
  }

  onClienteFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    input.value = '';
    if (file) this._importClientes(file);
  }

  private _importClientes(file: File): void {
    if (this.importingClientes) return;
    this.importingClientes   = true;
    this.clienteImportResult = null;
    this.clienteImportError  = null;
    this.clientesSvc.import(file).subscribe({
      next: (res) => {
        this.importingClientes   = false;
        this.clienteImportResult = res;
        if (res.inserted > 0 || res.updated > 0) {
          this.loadClientes();
          this.toast.success(`Importación: ${res.inserted} nuevos, ${res.updated} actualizados`);
        }
      },
      error: (err) => {
        this.importingClientes  = false;
        this.clienteImportError = err?.error?.error || 'Error al importar el archivo';
      },
    });
  }

  tipoClienteColor(tipo: string): string {
    const map: Record<string, string> = {
      'CLIENTE':            'badge-tipo-ingreso',
      'PROVEEDOR':          'badge-tipo-pasivo',
      'CLIENTE-PROVEEDOR':  'badge-tipo-capital',
    };
    return map[tipo] || 'badge-secondary';
  }
}
