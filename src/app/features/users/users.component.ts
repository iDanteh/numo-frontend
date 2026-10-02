import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { UserService, AppUserRecord, RoleOption, PermissionOption } from '../../core/services/user.service';
import { SocketService } from '../../core/services/socket.service';
import { EntityService, Entity } from '../../core/services/entity.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: false,
  selector: 'app-users',
  templateUrl: './users.component.html',
})
export class UsersComponent implements OnInit, OnDestroy {

  // ── Datos ────────────────────────────────────────────────────────────────────
  users:       AppUserRecord[]   = [];
  roles:       RoleOption[]      = [];
  permissions: PermissionOption[] = [];

  // ── Estado UI ────────────────────────────────────────────────────────────────
  activeTab:  'usuarios' | 'roles' | 'permisos' | 'matriz' = 'usuarios';
  loading     = false;
  error:      string | null = null;
  saving:     Record<number, boolean> = {};

  // ── Buscador de usuarios ──────────────────────────────────────────────────────
  searchQuery = '';

  private destroy$ = new Subject<void>();

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
  deletingRole:      string | null = null;
  roleModalPermSearch = '';
  private roleModalValueEdited = false;
  entidadesDisponibles: Entity[] = [];

  // ── Asignar empresa(s) fija(s) a usuario(s) de un rol ────────────────────────
  // Selección múltiple de AMBOS lados: N empresas × N usuarios en una sola
  // acción — agrega (o quita) todas las empresas marcadas a todos los
  // usuarios marcados, sin tocar el resto de empresas que ya tuvieran.
  showAsignarEmpresaModal = false;
  asignandoEmpresa        = false;
  empresaModalRoleValue   = '';
  empresaModalRfcs        = new Set<string>();
  empresaModalModo: 'agregar' | 'quitar' = 'agregar';
  empresaModalUserIds     = new Set<number>();
  empresaModalUserSearch  = '';

  // ── Permisos extra por usuario individual (además de los que da su rol) ──────
  // Puramente aditivo: solo se puede AGREGAR un permiso que el rol no dé ya,
  // nunca revocar uno que el rol sí conceda (confirmado con el usuario 2026-07-29).
  showExtraPermisosModal        = false;
  extraPermisosTarget: AppUserRecord | null = null;
  extraPermisosSelected          = new Set<string>();
  extraPermisosSearch            = '';
  extraPermisosSaving            = false;
  extraPermisosError: string | null = null;

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

  constructor(
    private userSvc: UserService,
    private socket:  SocketService,
    private entitySvc: EntityService,
    private toast:   ToastService,
  ) {}

  ngOnInit(): void {
    this.load();
    this.loadRoles();
    this.loadPermissions();
    this.entitySvc.list().subscribe(entidades => this.entidadesDisponibles = entidades);

    // Cuando cualquier admin modifique un rol, refrescar la lista en tiempo real
    this.socket.roleDefinitionUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadRoles());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
    const nombrePrevio = user.nombre || user.email;
    this.saving[user.id] = true;
    this.userSvc.updateRole(user.id, role).subscribe({
      next: (updated) => {
        const idx = this.users.findIndex(u => u.id === updated.id);
        if (idx !== -1) this.users[idx] = updated;
        delete this.saving[user.id];
        this.toast.success(`Rol de ${nombrePrevio} actualizado a "${this.roleLabel(role)}"`);
      },
      error: (err) => {
        this.toast.error(err?.error?.error || `Error al actualizar el rol de ${nombrePrevio}`);
        delete this.saving[user.id];
      },
    });
  }

  toggle(user: AppUserRecord): void {
    const nombre = user.nombre || user.email;
    const activarA = !user.isActive;
    this.saving[user.id] = true;
    this.userSvc.toggleActive(user.id).subscribe({
      next: (updated) => {
        const idx = this.users.findIndex(u => u.id === updated.id);
        if (idx !== -1) this.users[idx] = updated;
        delete this.saving[user.id];
        this.toast.success(activarA ? `${nombre} activado` : `${nombre} desactivado`);
      },
      error: (err) => {
        this.toast.error(err?.error?.error || `Error al actualizar el estado de ${nombre}`);
        delete this.saving[user.id];
      },
    });
  }

  isSaving(id: number): boolean { return !!this.saving[id]; }

  // ── Buscador + filtros de la tabla de usuarios ────────────────────────────────
  filtroRol: string | null = null;
  soloInactivos = false;

  get filteredUsers(): AppUserRecord[] {
    const q = this.searchQuery.toLowerCase().trim();
    return this.users
      .filter(u => !this.filtroRol || u.role === this.filtroRol)
      .filter(u => !this.soloInactivos || !u.isActive)
      .filter(u =>
        !q ||
        (u.nombre || '').toLowerCase().includes(q) ||
        (u.email  || '').toLowerCase().includes(q) ||
        this.roleLabel(u.role).toLowerCase().includes(q),
      );
  }

  get hayFiltrosActivos(): boolean {
    return !!this.searchQuery || !!this.filtroRol || this.soloInactivos;
  }

  setFiltroRol(value: string): void {
    this.filtroRol = this.filtroRol === value ? null : value;
  }

  toggleSoloInactivos(): void {
    this.soloInactivos = !this.soloInactivos;
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  get totalUsers():     number { return this.users.length; }
  get totalInactivos(): number { return this.users.filter(u => !u.isActive).length; }

  countByRole(value: string): number {
    return this.users.filter(u => u.role === value).length;
  }

  nombreEmpresa(rfc: string | null | undefined): string {
    if (!rfc) return '';
    return this.entidadesDisponibles.find(e => e.rfc === rfc)?.nombre ?? rfc;
  }

  nombresEmpresas(rfcs: string[] | null | undefined): string {
    return (rfcs ?? []).map(rfc => this.nombreEmpresa(rfc)).join(', ');
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
      this.roleModalValueEdited = false;
    }
    this.deletingRole       = null;
    this.roleModalPermSearch = '';
  }

  closeRoleForm(): void {
    this.roleModal.show       = false;
    this.roleModalPermSearch  = '';
  }

  // ── Asignar empresa(s) fija(s) a usuario(s) de un rol ────────────────────────
  // Solo se restringen los usuarios marcados explícitamente — el rol en sí no
  // impone ninguna empresa por defecto a nadie (confirmado con el usuario 2026-07-28).

  usuariosDelRolModal(): AppUserRecord[] {
    const q = this.empresaModalUserSearch.toLowerCase().trim();
    return this.users
      .filter(u => u.role === this.empresaModalRoleValue)
      .filter(u => !q || (u.nombre ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q));
  }

  abrirAsignarEmpresa(role: RoleOption): void {
    this.empresaModalRoleValue  = role.value;
    this.empresaModalRfcs       = new Set();
    this.empresaModalModo       = 'agregar';
    this.empresaModalUserIds    = new Set();
    this.empresaModalUserSearch = '';
    this.showAsignarEmpresaModal = true;
  }

  cerrarAsignarEmpresa(): void {
    this.showAsignarEmpresaModal = false;
  }

  isUsuarioMarcado(id: number): boolean {
    return this.empresaModalUserIds.has(id);
  }

  toggleUsuarioEnModal(id: number): void {
    if (this.empresaModalUserIds.has(id)) this.empresaModalUserIds.delete(id);
    else this.empresaModalUserIds.add(id);
  }

  isEmpresaMarcada(rfc: string): boolean {
    return this.empresaModalRfcs.has(rfc);
  }

  toggleEmpresaEnModal(rfc: string): void {
    if (this.empresaModalRfcs.has(rfc)) this.empresaModalRfcs.delete(rfc);
    else this.empresaModalRfcs.add(rfc);
  }

  get todosLosUsuariosMarcados(): boolean {
    const visibles = this.usuariosDelRolModal();
    return visibles.length > 0 && visibles.every(u => this.empresaModalUserIds.has(u.id));
  }

  toggleTodosLosUsuarios(): void {
    const visibles = this.usuariosDelRolModal();
    if (this.todosLosUsuariosMarcados) {
      for (const u of visibles) this.empresaModalUserIds.delete(u.id);
    } else {
      for (const u of visibles) this.empresaModalUserIds.add(u.id);
    }
  }

  get todasLasEmpresasMarcadas(): boolean {
    return this.entidadesDisponibles.length > 0 && this.entidadesDisponibles.every(e => this.empresaModalRfcs.has(e.rfc));
  }

  toggleTodasLasEmpresas(): void {
    if (this.todasLasEmpresasMarcadas) this.empresaModalRfcs = new Set();
    else this.empresaModalRfcs = new Set(this.entidadesDisponibles.map(e => e.rfc));
  }

  // Agrega o quita TODAS las empresas marcadas de la lista de empresas de
  // CADA usuario marcado — sin tocar las demás empresas que ya tuviera
  // (updateEmpresas reemplaza el array completo, así que aquí se calcula el
  // array final antes de mandarlo). Uno por usuario contra el endpoint
  // existente, no hace falta un endpoint de bulk aparte para este volumen.
  aplicarEmpresaAUsuarios(): void {
    const userIds = [...this.empresaModalUserIds];
    const rfcs = [...this.empresaModalRfcs];
    if (userIds.length === 0 || rfcs.length === 0) return;
    this.asignandoEmpresa = true;

    let pendientes = userIds.length;
    const fallidos: string[] = [];
    for (const id of userIds) {
      const user = this.users.find(u => u.id === id);
      const actuales = user?.empresaRfcs ?? [];
      const nuevas = this.empresaModalModo === 'agregar'
        ? [...new Set([...actuales, ...rfcs])]
        : actuales.filter(r => !rfcs.includes(r));

      this.userSvc.updateEmpresas(id, nuevas).subscribe({
        next: (updated) => {
          const idx = this.users.findIndex(u => u.id === updated.id);
          if (idx !== -1) this.users[idx] = updated;
          pendientes--;
          if (pendientes === 0) this.finalizarAsignacionEmpresa(userIds.length, fallidos);
        },
        error: () => {
          fallidos.push(user?.nombre || user?.email || `usuario #${id}`);
          pendientes--;
          if (pendientes === 0) this.finalizarAsignacionEmpresa(userIds.length, fallidos);
        },
      });
    }
  }

  private finalizarAsignacionEmpresa(total: number, fallidos: string[]): void {
    this.asignandoEmpresa = false;
    if (fallidos.length === 0) {
      this.toast.success(`Empresas actualizadas para ${total} usuario${total === 1 ? '' : 's'}`);
      this.showAsignarEmpresaModal = false;
      return;
    }
    // El modal queda abierto — los usuarios que SÍ fallaron siguen marcados, listos para reintentar.
    this.toast.error(`No se pudo actualizar: ${fallidos.join(', ')}`);
  }

  // ── Permisos extra por usuario individual ────────────────────────────────────

  abrirExtraPermisos(u: AppUserRecord): void {
    this.extraPermisosTarget   = u;
    this.extraPermisosSelected = new Set(u.extraPermissions ?? []);
    this.extraPermisosSearch   = '';
    this.extraPermisosError    = null;
    this.showExtraPermisosModal = true;
  }

  cerrarExtraPermisos(): void {
    this.showExtraPermisosModal = false;
    this.extraPermisosTarget    = null;
  }

  /** Permisos que el ROL del usuario objetivo ya concede (para deshabilitar esas casillas). */
  private rolePermsForTarget(): string[] {
    if (!this.extraPermisosTarget) return [];
    return this.roles.find(r => r.value === this.extraPermisosTarget!.role)?.permissions ?? [];
  }

  /**
   * true si el permiso ya lo da el rol del usuario (wildcard '*' = todos) — no es una casilla
   * accionable. Arrow function (no método normal): se pasa como [isDisabled] al componente
   * `app-permisos-checklist`, que la invoca sin bindearle `this`.
   */
  isPermFromRole = (key: string): boolean => {
    const rolePerms = this.rolePermsForTarget();
    return rolePerms.includes('*') || rolePerms.includes(key);
  };

  /** Arrow function por el mismo motivo que isPermFromRole — se pasa como [isChecked]. */
  isExtraPermChecked = (key: string): boolean => {
    return this.isPermFromRole(key) || this.extraPermisosSelected.has(key);
  };

  toggleExtraPerm(key: string): void {
    if (this.isPermFromRole(key)) return; // ya lo da el rol — no accionable
    if (this.extraPermisosSelected.has(key)) this.extraPermisosSelected.delete(key);
    else this.extraPermisosSelected.add(key);
  }

  get extraPermisosCount(): number {
    return this.extraPermisosSelected.size;
  }

  guardarExtraPermisos(): void {
    if (!this.extraPermisosTarget) return;
    const id = this.extraPermisosTarget.id;
    const nombre = this.extraPermisosTarget.nombre || this.extraPermisosTarget.email;
    this.extraPermisosError  = null;
    this.extraPermisosSaving = true;
    const extraPermissions = [...this.extraPermisosSelected];
    this.userSvc.updateExtraPermissions(id, extraPermissions).subscribe({
      next: (updated) => {
        const idx = this.users.findIndex(u => u.id === updated.id);
        if (idx !== -1) this.users[idx] = updated;
        this.extraPermisosSaving = false;
        this.showExtraPermisosModal = false;
        this.extraPermisosTarget = null;
        this.toast.success(`Permisos extra de ${nombre} guardados (${extraPermissions.length})`);
      },
      error: (err) => {
        this.extraPermisosSaving = false;
        this.extraPermisosError  = err?.error?.error || 'Error al guardar los permisos extra';
      },
    });
  }

  private slugify(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_-]/g, '')
      .replace(/^[^a-z]+/, '');
  }

  onRoleLabelChange(label: string): void {
    if (this.roleModal.mode !== 'create' || this.roleModalValueEdited) return;
    this.roleModal.value = this.slugify(label);
  }

  onRoleValueChange(value: string): void {
    // Marcar como editado manualmente para no sobreescribir con el auto-slug
    if (value) this.roleModalValueEdited = true;
  }

  isValidRoleValue(value: string): boolean {
    return /^[a-z][a-z0-9_-]+$/.test(value);
  }

  get roleModalHasWildcard(): boolean { return this.roleModal.perms.includes('*'); }

  toggleWildcard(): void {
    this.roleModal.perms = this.roleModalHasWildcard ? [] : ['*'];
  }

  /** Arrow function: se pasa como [isChecked] a `app-permisos-checklist` en el modal de rol. */
  isPermChecked = (key: string): boolean => this.roleModal.perms.includes(key);

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

  get selectedPermsCount(): number {
    return this.roleModalHasWildcard ? this.permissions.length : this.roleModal.perms.length;
  }

  saveRole(): void {
    this.roleModal.error  = null;
    this.roleModal.saving = true;
    const { mode, value, label, perms } = this.roleModal;
    const obs = mode === 'create'
      ? this.userSvc.createRoleDef({ value, label, permissions: perms })
      : this.userSvc.patchRoleDef(value, { label, permissions: perms });

    obs.subscribe({
      next: (saved) => {
        this.roleModal.saving = false;
        this.roleModal.show   = false;
        // Actualizar en memoria desde la respuesta — inmediato, sin segundo GET
        const idx = this.roles.findIndex(r => r.value === saved.value);
        if (idx !== -1) this.roles = this.roles.map((r, i) => i === idx ? saved : r);
        else            this.roles = [...this.roles, saved];
        this.toast.success(mode === 'create' ? `Rol "${saved.label}" creado` : `Rol "${saved.label}" actualizado`);
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
    const toDelete = this.deletingRole;
    const label    = this.roleLabel(toDelete);
    this.roles      = this.roles.filter(r => r.value !== toDelete); // optimistic
    this.deletingRole = null;
    this.userSvc.deleteRoleDef(toDelete).subscribe({
      next:  () => {
        this.loadRoles();
        this.load();
        this.toast.success(`Rol "${label}" eliminado`);
      },
      error: (err) => {
        this.toast.error(err?.error?.error || `Error al eliminar el rol "${label}"`);
        this.loadRoles(); // restaurar lista si el backend rechazó la operación
      },
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
        this.toast.success(`Permiso "${key}" creado`);
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
    const key = this.deletingPerm;
    this.userSvc.deletePermDef(key).subscribe({
      next: () => {
        this.deletingPerm = null;
        this.loadPermissions();
        this.toast.success(`Permiso "${key}" eliminado`);
      },
      error: (err) => {
        this.toast.error(err?.error?.error || `Error al eliminar el permiso "${key}"`);
        this.deletingPerm = null;
      },
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

  /**
   * Devuelve las primeras N etiquetas de permisos del rol para mostrar en la tabla,
   * más el número de permisos adicionales no mostrados.
   */
  rolePermSummary(role: RoleOption, max = 4): { shown: string[]; extra: number } {
    if (role.permissions.includes('*')) return { shown: [], extra: 0 };
    const labels = role.permissions
      .map(key => this.permissions.find(p => p.key === key)?.label ?? key);
    return { shown: labels.slice(0, max), extra: Math.max(0, labels.length - max) };
  }

  // ── Matriz de permisos ────────────────────────────────────────────────────────

  get matrixModules(): string[] {
    return [...new Set(this.permissions.map(p => p.module))].sort();
  }

  permsByModuleForMatrix(module: string): PermissionOption[] {
    return this.permissions.filter(p => p.module === module);
  }

  roleHasPerm(role: RoleOption, key: string): boolean {
    return role.permissions.includes('*') || role.permissions.includes(key);
  }

  roleIsWildcard(role: RoleOption): boolean {
    return role.permissions.includes('*');
  }

  get matrixPermCount(): number {
    return this.permissions.length;
  }
}
