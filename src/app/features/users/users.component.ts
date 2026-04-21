import { Component, OnInit } from '@angular/core';
import { UserService, AppUserRecord, RoleOption, PermissionOption } from '../../core/services/user.service';

@Component({
  standalone: false,
  selector: 'app-users',
  templateUrl: './users.component.html',
})
export class UsersComponent implements OnInit {

  // ── Datos ────────────────────────────────────────────────────────────────────
  users:       AppUserRecord[]   = [];
  roles:       RoleOption[]      = [];
  permissions: PermissionOption[] = [];

  // ── Estado UI ────────────────────────────────────────────────────────────────
  activeTab:  'usuarios' | 'roles' | 'permisos' = 'usuarios';
  loading     = false;
  error:      string | null = null;
  saving:     Record<number, boolean> = {};

  // ── Formulario de rol ────────────────────────────────────────────────────────
  roleModal = {
    show:     false,
    mode:     'create' as 'create' | 'edit',
    value:    '',
    label:    '',
    perms:    [] as string[],
    isSystem: false,
    error:    null as string | null,
    saving:   false,
  };
  deletingRole: string | null = null;

  // ── Formulario de permiso ─────────────────────────────────────────────────────
  permModal = {
    show:   false,
    key:    '',
    label:  '',
    module: '',
    error:  null as string | null,
    saving: false,
  };
  deletingPerm: string | null = null;

  private readonly PALETTE = [
    { bg: '#ede9fe', text: '#5b21b6' },
    { bg: '#d1fae5', text: '#065f46' },
    { bg: '#fef9c3', text: '#92400e' },
    { bg: '#fff7ed', text: '#9a3412' },
    { bg: '#dbeafe', text: '#1e40af' },
    { bg: '#fce7f3', text: '#9d174d' },
  ];

  constructor(private userSvc: UserService) {}

  ngOnInit(): void {
    this.load();
    this.loadRoles();
    this.loadPermissions();
  }

  load(): void {
    this.loading = true;
    this.error   = null;
    this.userSvc.listUsers().subscribe({
      next:  (data) => { this.users = data; this.loading = false; },
      error: (err)  => { this.error = err?.error?.error || 'Error al cargar usuarios'; this.loading = false; },
    });
  }

  private loadRoles(): void {
    this.userSvc.getRoles().subscribe({
      next:  (data) => (this.roles = data),
      error: () => {
        this.roles = [
          { value: 'admin',        label: 'Administrador', permissions: ['*'],    isSystem: true },
          { value: 'contabilidad', label: 'Contabilidad',  permissions: [],       isSystem: true },
          { value: 'cobranza',     label: 'Cobranza',      permissions: [],       isSystem: true },
          { value: 'tienda',       label: 'Tienda',        permissions: [],       isSystem: true },
        ];
      },
    });
  }

  private loadPermissions(): void {
    this.userSvc.getPermissions().subscribe({
      next: (data) => (this.permissions = data),
    });
  }

  changeRole(user: AppUserRecord, role: string): void {
    if (user.role === role) return;
    this.saving[user.id] = true;
    this.userSvc.updateRole(user.id, role).subscribe({
      next: (updated) => {
        const idx = this.users.findIndex(u => u.id === updated.id);
        if (idx !== -1) this.users[idx] = updated;
        delete this.saving[user.id];
      },
      error: (err) => {
        this.error = err?.error?.error || 'Error al actualizar rol';
        delete this.saving[user.id];
      },
    });
  }

  toggle(user: AppUserRecord): void {
    this.saving[user.id] = true;
    this.userSvc.toggleActive(user.id).subscribe({
      next: (updated) => {
        const idx = this.users.findIndex(u => u.id === updated.id);
        if (idx !== -1) this.users[idx] = updated;
        delete this.saving[user.id];
      },
      error: (err) => {
        this.error = err?.error?.error || 'Error al actualizar estado';
        delete this.saving[user.id];
      },
    });
  }

  isSaving(id: number): boolean { return !!this.saving[id]; }

  // ── Stats ────────────────────────────────────────────────────────────────────

  get totalUsers():     number { return this.users.length; }
  get totalInactivos(): number { return this.users.filter(u => !u.isActive).length; }

  countByRole(value: string): number {
    return this.users.filter(u => u.role === value).length;
  }

  // ── Helpers de rol ────────────────────────────────────────────────────────────

  roleLabel(value: string): string {
    return this.roles.find(r => r.value === value)?.label ?? value;
  }

  roleColor(value: string): { bg: string; text: string } {
    const idx = this.roles.findIndex(r => r.value === value);
    return this.PALETTE[Math.max(0, idx) % this.PALETTE.length];
  }

  initials(u: AppUserRecord): string {
    const src = u.nombre || u.email || '?';
    return src[0].toUpperCase();
  }

  // ── Gestión de roles — formulario ─────────────────────────────────────────────

  openRoleForm(role?: RoleOption): void {
    if (role) {
      this.roleModal = {
        show: true, mode: 'edit',
        value:    role.value,
        label:    role.label,
        perms:    [...(role.permissions ?? [])],
        isSystem: role.isSystem ?? false,
        error: null, saving: false,
      };
    } else {
      this.roleModal = {
        show: true, mode: 'create',
        value: '', label: '', perms: [],
        isSystem: false, error: null, saving: false,
      };
    }
    this.deletingRole = null;
  }

  closeRoleForm(): void { this.roleModal.show = false; }

  get roleModalHasWildcard(): boolean { return this.roleModal.perms.includes('*'); }

  toggleWildcard(): void {
    this.roleModal.perms = this.roleModalHasWildcard ? [] : ['*'];
  }

  isPermChecked(key: string): boolean { return this.roleModal.perms.includes(key); }

  toggleRolePerm(key: string): void {
    if (this.roleModalHasWildcard) return;
    const idx = this.roleModal.perms.indexOf(key);
    if (idx === -1) this.roleModal.perms = [...this.roleModal.perms, key];
    else            this.roleModal.perms = this.roleModal.perms.filter(p => p !== key);
  }

  allModulePermsChecked(module: string): boolean {
    const keys = this.permissions.filter(p => p.module === module).map(p => p.key);
    return keys.length > 0 && keys.every(k => this.isPermChecked(k));
  }

  toggleModule(module: string): void {
    if (this.roleModalHasWildcard) return;
    const keys = this.permissions.filter(p => p.module === module).map(p => p.key);
    const allChecked = this.allModulePermsChecked(module);
    if (allChecked) {
      this.roleModal.perms = this.roleModal.perms.filter(p => !keys.includes(p));
    } else {
      const toAdd = keys.filter(k => !this.roleModal.perms.includes(k));
      this.roleModal.perms = [...this.roleModal.perms, ...toAdd];
    }
  }

  get permsByModule(): { module: string; perms: PermissionOption[] }[] {
    const map = new Map<string, PermissionOption[]>();
    for (const p of this.permissions) {
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module)!.push(p);
    }
    return Array.from(map.entries()).map(([module, perms]) => ({ module, perms }));
  }

  saveRole(): void {
    this.roleModal.error  = null;
    this.roleModal.saving = true;
    const { mode, value, label, perms } = this.roleModal;
    const obs = mode === 'create'
      ? this.userSvc.createRoleDef({ value, label, permissions: perms })
      : this.userSvc.patchRoleDef(value, { label, permissions: perms });

    obs.subscribe({
      next: () => {
        this.roleModal.saving = false;
        this.roleModal.show   = false;
        this.loadRoles();
      },
      error: (err) => {
        this.roleModal.saving = false;
        this.roleModal.error  = err?.error?.error || 'Error al guardar el rol';
      },
    });
  }

  confirmDeleteRole(value: string): void {
    this.deletingRole = value;
    this.roleModal.show = false;
  }

  cancelDeleteRole(): void { this.deletingRole = null; }

  doDeleteRole(): void {
    if (!this.deletingRole) return;
    this.userSvc.deleteRoleDef(this.deletingRole).subscribe({
      next: () => { this.deletingRole = null; this.loadRoles(); this.load(); },
      error: (err) => { this.error = err?.error?.error || 'Error al eliminar el rol'; this.deletingRole = null; },
    });
  }

  // ── Gestión de permisos — formulario ──────────────────────────────────────────

  openPermForm(): void {
    this.permModal = { show: true, key: '', label: '', module: '', error: null, saving: false };
    this.deletingPerm = null;
  }

  closePermForm(): void { this.permModal.show = false; }

  savePerm(): void {
    this.permModal.error  = null;
    this.permModal.saving = true;
    const { key, label, module } = this.permModal;
    this.userSvc.createPermDef({ key, label, module }).subscribe({
      next: () => {
        this.permModal.saving = false;
        this.permModal.show   = false;
        this.loadPermissions();
      },
      error: (err) => {
        this.permModal.saving = false;
        this.permModal.error  = err?.error?.error || 'Error al crear el permiso';
      },
    });
  }

  confirmDeletePerm(key: string): void { this.deletingPerm = key; }
  cancelDeletePerm(): void { this.deletingPerm = null; }

  doDeletePerm(): void {
    if (!this.deletingPerm) return;
    this.userSvc.deletePermDef(this.deletingPerm).subscribe({
      next: () => { this.deletingPerm = null; this.loadPermissions(); },
      error: (err) => { this.error = err?.error?.error || 'Error al eliminar el permiso'; this.deletingPerm = null; },
    });
  }

  // ── Módulos únicos para el catálogo de permisos ──────────────────────────────

  get uniqueModules(): string[] {
    return [...new Set(this.permissions.map(p => p.module))].sort();
  }

  permsByModuleFilter(module: string): PermissionOption[] {
    return this.permissions.filter(p => p.module === module);
  }

  rolesUsingPerm(key: string): string[] {
    return this.roles
      .filter(r => Array.isArray(r.permissions) && (r.permissions.includes('*') || r.permissions.includes(key)))
      .map(r => r.label);
  }
}
