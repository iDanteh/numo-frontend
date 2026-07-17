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
      items: [
        { label: 'CFDIs',        icon: '▦',  route: '/dashboard', permissions: ['visor:read'] },
        { label: 'Ver CFDIs',    icon: '⊡', route: '/cfdis',     permissions: ['visor:read'] },
        { label: 'Descarga SAT', icon: '⬇', route: '/sat',       permissions: ['visor:read'] },
        { label: 'Importar',     icon: '⬆', route: '/import',    permissions: ['visor:read'] },
      ],
    },
    {
      label: 'Contabilidad',
      items: [
        { label: 'Catálogo de Cuentas', icon: '📒', route: '/account-plan', permissions: ['account-plan:read'] },
        { label: 'Asientos Contables',  icon: '📋', route: '/polizas',      permissions: ['polizas:read'] },
        { label: 'Ejercicios',          icon: '◫',  route: '/ejercicios',   permissions: ['account-plan:read'] },
      ],
    },
    {
      label: 'Reportes',
      items: [
        { label: 'CFDIs con Pagos', icon: '💳', route: '/reportes/pagos-banco', permissions: ['visor:reports'] },
        { label: 'Depósitos Ingresos', icon: '🧾', route: '/reportes/depositos-ingresos', permissions: ['visor:reports'] },
      ],
    },
    {
      label: 'Administración',
      items: [
        { label: 'Usuarios y Roles',     icon: '👥', route: '/users',    permissions: ['users:manage'] },
        { label: 'Entidades Fiscales',   icon: '🏢', route: '/entities', permissions: ['entities:read'] },
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

  /** Una sección se muestra si al menos uno de sus ítems es visible para el
   *  usuario — evita que un permiso de sección distinto al de sus ítems
   *  (ej. 'users:manage' en la sección, 'entities:read' en el ítem) oculte
   *  ítems a los que el usuario sí tiene acceso. */
  sectionVisible(section: NavSection): boolean {
    return section.items.some(item => this.canSee(item.permissions));
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
  }

  logout(): void {
    this.auth.logout();
  }
}
