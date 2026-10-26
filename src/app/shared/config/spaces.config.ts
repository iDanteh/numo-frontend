import { inject } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

/**
 * Catálogo de "Espacios de NUMO" — fuente única para SpaceSwitcherComponent
 * (src/app/shared/components/space-switcher/), que reemplaza el click
 * directo que antes vivía hardcodeado en SidebarComponent.switchToLealtad()
 * y LealtadShellComponent.switchToNumo(). Agregar un tercer espacio en el
 * futuro es solo sumar una entrada acá — el componente del dropdown no
 * necesita tocarse (spec "Space-Switcher Navigation").
 *
 * Mismo patrón que administracion-nav.config.ts: un solo origen compartido
 * entre ambos shells en vez de lógica duplicada y propensa a divergir.
 */
export interface Space {
  id: string;
  label: string;
  /** Nombre largo cuando `label` es una abreviatura (tooltip de su fila y avisos). */
  nombre?: string;
  /** Nombre de ícono lucide en kebab-case (ver LayoutModule/LealtadModule para el set registrado).
   *  Fallback cuando el espacio no tiene `image` propia. */
  icon: string;
  /** Asset propio del espacio (logo/mascota), renderizado en vez del ícono
   *  lucide genérico en el panel del dropdown (ver SpaceSwitcherComponent).
   *  Misma convención de ruta que los assets ya usados en SidebarComponent
   *  (p. ej. 'numo-N.svg'): se sirven desde la carpeta public/ sin prefijo. */
  image?: string;
  /** Subtítulo mostrado bajo el nombre del espacio en el trigger grande
   *  (ver SpaceSwitcherComponent / .ssw__logo-sub). */
  subtitle: string;
  /** Color de marca del espacio (hex) — usado para resaltar su fila cuando
   *  es la actual en el panel del dropdown (ver SpaceSwitcherComponent.rowBackground()). */
  accent: string;
  /** Color del ícono de check mostrado en la fila actual del dropdown.
   *  Opcional para mantener el criterio de "agregar un espacio nuevo es solo
   *  sumar una entrada acá" — si no se define, el componente cae a un
   *  default razonable. */
  checkColor?: string;
  /** Texto de un pill ("NUEVO") mostrado junto al espacio cuando se lo
   *  ofrece desde el dropdown de OTRO espacio (fila no actual). Sin definir
   *  → sin pill. */
  badge?: string;
  /**
   * Ruta fija, o función que la resuelve en el momento del click. Numo la
   * necesita dinámica (AuthService.getLandingPage() depende del rol del
   * usuario logueado), así que usa inject() — debe invocarse dentro de un
   * contexto de inyección válido (ver SpaceSwitcherComponent.resolveRoute(),
   * que la envuelve en runInInjectionContext()).
   */
  route?: string | (() => string);
  /**
   * Espacio que vive en OTRA aplicación: en vez de navegar a `route`, se pide
   * a este endpoint (POST, relativo a environment.apiUrl) una url con un pase de
   * un solo uso y el navegador se va a ella. Ver EspaciosService.
   */
  pase?: string;
  /** Permiso requerido para ver este espacio. Sin definir → visible para
   *  cualquier usuario autenticado (caso de Numo: todos los que llegan al
   *  shell ya pasaron el AuthGuard). */
  permission?: string;
  /** En un espacio externo (`pase`) el telón se queda puesto hasta que el navegador cambia de página. */
  transitionVariant?: 'to-lealtad' | 'to-numo' | 'to-kiosco';
}

export const SPACES: Space[] = [
  {
    id: 'numo',
    label: 'NUMO',
    icon: 'layout-dashboard',
    image: 'numo-N.svg',
    subtitle: 'Sistema contable',
    accent: '#4f46e5',
    checkColor: '#fff',
    route: () => inject(AuthService).getLandingPage(),
    transitionVariant: 'to-numo',
  },
  {
    id: 'lealtad',
    label: 'Lealtad',
    icon: 'credit-card',
    image: 'MaestroBetoGrande.png',
    subtitle: 'Puntos y recompensas',
    accent: '#f59e0b',
    checkColor: '#fbbf24',
    badge: 'NUEVO',
    route: '/lealtad',
    permission: 'loyalty:read',
    transitionVariant: 'to-lealtad',
  },
  {
    // Panel de administración del Kiosco de facturación (otra aplicación). NUMO
    // revisa kiosco:admin y firma el pase; lo que la persona puede hacer adentro
    // lo decide su rol en el kiosco (la primera vez entra solo a ver).
    id: 'kiosco',
    // En el menú solo "KF" con su logo: el nombre completo no cabía en el ancho del sidebar.
    label: 'KF',
    nombre: 'Kiosco de facturación',
    icon: 'receipt-text',
    image: 'kiosco-logo.webp',
    subtitle: 'Panel de administración',
    accent: '#1a2b5f',
    badge: 'NUEVO',
    pase: '/espacios/kiosco/pase',
    permission: 'kiosco:admin',
    transitionVariant: 'to-kiosco',
  },
];
