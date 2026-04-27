import { Component } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

interface NavItem {
  label:        string;
  icon:         string;
  route:        string;
  permissions?: string[];
}

interface NavSection {
  label:        string;
  permissions?: string[];
  items:        NavItem[];
}

@Component({
  standalone: false,
  selector:   'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls:  ['./sidebar.component.css'],
})
export class SidebarComponent {
  collapsed = false;

  readonly sections: NavSection[] = [
    {
      label: 'Principal',
      items: [
        { label: 'Bancos',               icon: '₿',  route: '/banks',               permissions: ['banks:read'] },
        { label: 'Solicitudes de Cobro', icon: '📷', route: '/collection-requests', permissions: ['collections:read'] },
      ],
    },
    {
      label: 'CFDIs',
      permissions: ['visor:read'],
      items: [
        { label: 'CFDIs',        icon: '▦',  route: '/dashboard' },
        { label: 'Ver CFDIs',    icon: '⊡', route: '/cfdis' },
        { label: 'Descarga SAT', icon: '⬇', route: '/sat' },
        { label: 'Importar',     icon: '⬆', route: '/import' },
      ],
    },
    {
      label: 'Contabilidad',
      permissions: ['account-plan:read'],
      items: [
        { label: 'Catálogo de Cuentas', icon: '📒', route: '/account-plan' },
        { label: 'Ejercicios',          icon: '◫',  route: '/ejercicios' },
      ],
    },
    {
      label: 'Administración',
      permissions: ['users:manage'],
      items: [
        { label: 'Usuarios y Roles', icon: '👥', route: '/users' },
      ],
    },
  ];

  constructor(public auth: AuthService) {}

  /** Returns true if the user has at least one of the required permissions.
   *  No permissions specified → always visible. */
  canSee(permissions?: string[]): boolean {
    if (!permissions?.length) return true;
    return permissions.some(p => this.auth.hasPermission(p));
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
  }

  logout(): void {
    this.auth.logout();
  }
}
