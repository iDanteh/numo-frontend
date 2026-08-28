import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

interface NavItem {
  label:        string;
  icon:         string;
  route?:       string;
  permissions?: string[];
  children?:    NavItem[];
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
  // Preferencia persistida (mismo criterio que DASHBOARD_CARDS_COLLAPSED_KEY
  // en banks.component.ts) — el sidebar no debe volver a expandirse solo
  // porque el usuario recargó la página.
  private static readonly COLLAPSED_KEY = 'numo_sidebar_collapsed';

  collapsed = SidebarComponent.readCollapsed();

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
        { label: 'Catálogo de Cuentas', icon: '▧', route: '/account-plan', permissions: ['account-plan:read'] },
        {
          label: 'Asientos Contables', icon: '⊞', permissions: ['polizas:read'],
          children: [
            { label: 'Pólizas de Ingreso',  icon: '▤', route: '/polizas',          permissions: ['polizas:read'] },
            { label: 'Pólizas de Cobranza', icon: '▥', route: '/polizas/cobranza', permissions: ['polizas:read'] },
            { label: 'Pólizas Traspasos C.P.', icon: '⇄', route: '/polizas/traspasos-cp', permissions: ['polizas:read'] },
            { label: 'Pólizas Comp. / Int. Ganados', icon: '%', route: '/polizas/compensaciones-intereses', permissions: ['polizas:read'] },
          ],
        },
        { label: 'Ejercicios',          icon: '◫',  route: '/ejercicios',   permissions: ['account-plan:read'] },
      ],
    },
    {
      label: 'Reportes',
      items: [
        { label: 'CFDIs con Pagos', icon: '⊕', route: '/reportes/pagos-banco', permissions: ['visor:reports'] },
        { label: 'Depósitos Ingresos', icon: '▨', route: '/reportes/depositos-ingresos', permissions: ['visor:reports'] },
      ],
    },
    {
      label: 'Administración',
      items: [
        { label: 'Usuarios y Roles',     icon: '👥', route: '/users',    permissions: ['users:manage'] },
        { label: 'Entidades Fiscales',   icon: '🏢', route: '/entities', permissions: ['entities:read'] },
        { label: 'Configuraciones Globales', icon: '⚙', route: '/config', permissions: ['config:manage'] },
      ],
    },
  ];

  // Ítems padre (con children) expandidos manualmente por el usuario — se
  // suma a la expansión automática cuando la ruta actual coincide con un hijo.
  private readonly expandedManual = new Set<string>();

  constructor(public auth: AuthService, private router: Router) {}

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

  private currentUrl(): string {
    return this.router.url.split('?')[0].split('#')[0];
  }

  /** Coincidencia exacta con la ruta actual (no por prefijo) — necesario
   *  porque '/polizas' es prefijo de '/polizas/cobranza' y no deben marcarse
   *  ambos hijos activos a la vez. */
  isChildActive(child: NavItem): boolean {
    return !!child.route && this.currentUrl() === child.route;
  }

  hasActiveChild(item: NavItem): boolean {
    return (item.children ?? []).some(c => this.isChildActive(c));
  }

  isExpanded(item: NavItem): boolean {
    return this.expandedManual.has(item.label) || this.hasActiveChild(item);
  }

  toggleExpand(item: NavItem): void {
    if (this.expandedManual.has(item.label)) this.expandedManual.delete(item.label);
    else this.expandedManual.add(item.label);
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    try {
      localStorage.setItem(SidebarComponent.COLLAPSED_KEY, String(this.collapsed));
    } catch {
      // localStorage puede fallar en modo privado/cuota llena — la preferencia simplemente no persiste.
    }
  }

  private static readCollapsed(): boolean {
    try {
      return localStorage.getItem(SidebarComponent.COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  }

  logout(): void {
    this.auth.logout();
  }
}
