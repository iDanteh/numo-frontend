import { Component, OnInit } from '@angular/core';
import { UserService, AppUserRecord } from '../../core/services/user.service';

@Component({
  standalone: false,
  selector: 'app-users',
  templateUrl: './users.component.html',
})
export class UsersComponent implements OnInit {

  users:   AppUserRecord[] = [];
  loading  = false;
  error:   string | null = null;
  saving:  Record<string, boolean> = {};

  readonly ROLES = [
    { value: 'admin',    label: 'Administrador' },
    { value: 'contador', label: 'Contador' },
    { value: 'viewer',   label: 'Visualizador' },
  ];

  constructor(private userSvc: UserService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error   = null;
    this.userSvc.listUsers().subscribe({
      next:  (data) => { this.users = data; this.loading = false; },
      error: (err)  => { this.error = err?.error?.error || 'Error al cargar usuarios'; this.loading = false; },
    });
  }

  changeRole(user: AppUserRecord, role: string): void {
    if (user.role === role) return;
    this.saving[user._id] = true;
    this.userSvc.updateRole(user._id, role).subscribe({
      next: (updated) => {
        const idx = this.users.findIndex(u => u._id === updated._id);
        if (idx !== -1) this.users[idx] = updated;
        delete this.saving[user._id];
      },
      error: (err) => {
        this.error = err?.error?.error || 'Error al actualizar rol';
        delete this.saving[user._id];
      },
    });
  }

  toggle(user: AppUserRecord): void {
    this.saving[user._id] = true;
    this.userSvc.toggleActive(user._id).subscribe({
      next: (updated) => {
        const idx = this.users.findIndex(u => u._id === updated._id);
        if (idx !== -1) this.users[idx] = updated;
        delete this.saving[user._id];
      },
      error: (err) => {
        this.error = err?.error?.error || 'Error al actualizar estado';
        delete this.saving[user._id];
      },
    });
  }

  isSaving(id: string): boolean { return !!this.saving[id]; }

  // ── Stats ────────────────────────────────────────────────────────────────────

  get totalUsers():    number { return this.users.length; }
  get totalAdmins():   number { return this.users.filter(u => u.role === 'admin').length; }
  get totalContadores(): number { return this.users.filter(u => u.role === 'contador').length; }
  get totalViewers():  number { return this.users.filter(u => u.role === 'viewer').length; }
  get totalInactivos(): number { return this.users.filter(u => !u.isActive).length; }

  initials(u: AppUserRecord): string {
    const src = u.nombre || u.email || '?';
    return src[0].toUpperCase();
  }
}
