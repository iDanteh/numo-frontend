import { Component } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

interface NavItem {
  label: string;
  icon:  string;
  route: string;
  roles?: string[];
}

interface NavSection {
  label:  string;
  roles?: string[];
  items:  NavItem[];
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
        { label: 'Bancos',               icon: '₿',  route: '/banks', roles: ['admin'], },
        { label: 'Solicitudes de Cobro', icon: '📷', route: '/collection-requests', roles: ['admin'] },
      ],
    },
    {
      label: 'CFDIs',
      roles: ['admin'],
      items: [
        { label: 'CFDIs',        icon: '▦',  route: '/dashboard' },
       { label: 'Ver CFDIs',    icon: '⊡', route: '/cfdis' },
        { label: 'Descarga SAT', icon: '⬇', route: '/sat' },
        { label: 'Importar',     icon: '⬆', route: '/import' },
      ],
    },
    {
      label: 'Contabilidad',
      roles: ['admin'],
      items: [
        { label: 'Catálogo de Cuentas', icon: '📒', route: '/account-plan' },
        { label: 'Ejercicios',          icon: '◫',  route: '/ejercicios' },
      ],
    },
    {
      label: 'Administración',
      roles: ['admin'],
      items: [
        { label: 'Usuarios y Roles', icon: '👥', route: '/users' },
      ],
    },
  ];

  constructor(public auth: AuthService) {}

  canSee(roles?: string[]): boolean {
    if (!roles?.length) return true;
    return roles.some(r => this.auth.hasRole(r));
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
  }

  logout(): void {
    this.auth.logout();
  }
}
