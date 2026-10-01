import { Component, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

interface NavItem {
  label:        string;
  /** Nombre de ícono lucide en kebab-case (ver LayoutModule para el set registrado). */
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
        { label: 'Bancos',               icon: 'landmark',          route: '/banks',               permissions: ['banks:read'] },
        { label: 'Solicitudes de Cobro', icon: 'camera',            route: '/collection-requests', permissions: ['collections:read'] },
      ],
    },
    {
      label: 'CFDIs',
      items: [
        { label: 'CFDIs',        icon: 'layout-dashboard', route: '/dashboard', permissions: ['visor:read'] },
        { label: 'Ver CFDIs',    icon: 'files',             route: '/cfdis',     permissions: ['visor:read'] },
        { label: 'Descarga SAT', icon: 'download',          route: '/sat',       permissions: ['visor:read'] },
        { label: 'Importar',     icon: 'upload',            route: '/import',    permissions: ['visor:read'] },
      ],
    },
    {
      label: 'Contabilidad',
      items: [
        { label: 'Catálogo de Cuentas', icon: 'list-tree', route: '/account-plan', permissions: ['account-plan:read'] },
        {
          label: 'Asientos Contables', icon: 'layers', permissions: ['polizas:read'],
          children: [
            { label: 'Pólizas de Ingreso',  icon: 'file-input',       route: '/polizas',          permissions: ['polizas:read'] },
            { label: 'Pólizas de Cobranza', icon: 'hand-coins',       route: '/polizas/cobranza', permissions: ['polizas:read'] },
            { label: 'Pólizas Traspasos C.P.', icon: 'arrow-left-right', route: '/polizas/traspasos-cp', permissions: ['polizas:read'] },
            { label: 'Pólizas Comp. / Int. Ganados', icon: 'percent', route: '/polizas/compensaciones-intereses', permissions: ['polizas:read'] },
          ],
        },
        { label: 'Ejercicios',          icon: 'calendar-range', route: '/ejercicios', permissions: ['account-plan:read'] },
      ],
    },
    {
      label: 'Reportes',
      items: [
        { label: 'CFDIs con Pagos', icon: 'receipt-text', route: '/reportes/pagos-banco', permissions: ['visor:reports'] },
        { label: 'Depósitos Ingresos', icon: 'bar-chart-3', route: '/reportes/depositos-ingresos', permissions: ['visor:reports'] },
        { label: 'Cierre de Mes', icon: 'lock', route: '/reportes/cierre-de-mes', permissions: ['visor:reports'] },
      ],
    },
    {
      label: 'Administración',
      items: [
        { label: 'Usuarios y Roles',     icon: 'users',      route: '/users',    permissions: ['users:manage'] },
        { label: 'Entidades Fiscales',   icon: 'building-2', route: '/entities', permissions: ['entities:read'] },
        { label: 'Configuraciones Globales', icon: 'settings', route: '/config', permissions: ['config:manage'] },
        { label: 'Tráfico del Sistema',  icon: 'activity',   route: '/system-monitor', permissions: ['system:monitor:read'] },
      ],
    },
  ];

  // Ítems padre (con children) expandidos manualmente por el usuario — se
  // suma a la expansión automática cuando la ruta actual coincide con un hijo.
  private readonly expandedManual = new Set<string>();

  // ── Flyout de submenú en modo colapsado ──────────────────────────
  // Con el sidebar colapsado, los hijos de un item padre no caben inline:
  // se muestran en un panel flotante posicionado junto al botón que lo abrió.
  flyoutItem: NavItem | null = null;
  flyoutTop = 0;
  private flyoutCloseTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (this.collapsed) return; // en modo colapsado la navegación de hijos va por el flyout, no por expansión inline
    if (this.expandedManual.has(item.label)) this.expandedManual.delete(item.label);
    else this.expandedManual.add(item.label);
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    this.closeFlyout();
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

  // ── Flyout ────────────────────────────────────────────────────────
  onParentTriggerEnter(item: NavItem, event: Event): void {
    if (!this.collapsed || !item.children?.length) return;
    this.cancelFlyoutClose();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.flyoutTop = rect.top;
    this.flyoutItem = item;
  }

  scheduleFlyoutClose(): void {
    this.cancelFlyoutClose();
    this.flyoutCloseTimer = setTimeout(() => { this.flyoutItem = null; }, 150);
  }

  cancelFlyoutClose(): void {
    if (this.flyoutCloseTimer !== null) {
      clearTimeout(this.flyoutCloseTimer);
      this.flyoutCloseTimer = null;
    }
  }

  closeFlyout(): void {
    this.cancelFlyoutClose();
    this.flyoutItem = null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.flyoutItem) this.closeFlyout();
  }
}
