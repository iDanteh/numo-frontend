/**
 * Config compartida de la sección "Administración" — antes vivía hardcodeada
 * dos veces (una por cada sidebar): la de Numo (SidebarComponent) y, con
 * sistema-lealtad, la nueva del shell de Lealtad (LealtadShellComponent).
 * Un solo origen evita que ambas listas diverjan con el tiempo (spec
 * "Shared Administración Section": ambos shells deben listar exactamente
 * los mismos ítems).
 */
export interface NavItem {
  label: string;
  /** Nombre de ícono lucide en kebab-case (ver LayoutModule/LealtadModule para el set registrado). */
  icon: string;
  route?: string;
  permissions?: string[];
  children?: NavItem[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const ADMINISTRACION_NAV: NavSection = {
  label: 'Administración',
  items: [
    { label: 'Usuarios y Roles',         icon: 'users',      route: '/users',          permissions: ['users:manage'] },
    { label: 'Entidades Fiscales',       icon: 'building-2', route: '/entities',       permissions: ['entities:read'] },
    // 'loyalty:config' incluido a propósito: quien solo administra Lealtad debe poder entrar a
    // esta pantalla para ver/editar esa sección embebida, aunque no tenga config:manage general.
    { label: 'Configuraciones Globales', icon: 'settings',   route: '/config',         permissions: ['config:manage', 'loyalty:config'] },
    { label: 'Tráfico del Sistema',      icon: 'activity',   route: '/system-monitor', permissions: ['system:monitor:read'] },
    // Sumado por el merge main->Lenin (main lo tenía hardcodeado en SidebarComponent).
    { label: 'Monitor de Pólizas',       icon: 'file-search', route: '/polizas-auditoria', permissions: ['polizas:audit:read'] },
  ],
};
