/**
 * Preferencia de colapso del rail lateral, persistida en localStorage y
 * COMPARTIDA entre todos los shells (SidebarComponent/Numo y
 * LealtadShellComponent/Lealtad, y cualquier espacio futuro): si el usuario
 * colapsa el rail en un espacio, debe seguir colapsado al entrar a otro.
 *
 * Extraído de SidebarComponent (antes COLLAPSED_KEY/readCollapsed() propios)
 * para que ambos shells lean/escriban exactamente la misma key en vez de
 * mantener dos copias propensas a divergir — mismo criterio que
 * administracion-nav.config.ts / spaces.config.ts.
 */
export const SIDEBAR_COLLAPSED_KEY = 'numo_sidebar_collapsed';

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(value: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
  } catch {
    // localStorage puede fallar en modo privado/cuota llena — la preferencia simplemente no persiste.
  }
}
