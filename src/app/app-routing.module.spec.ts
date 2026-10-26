import { routes } from './app-routing.module';
import { AuthGuard } from './core/guards/auth.guard';
import { PermissionGuard } from './core/guards/permission.guard';

// Mismo criterio que collection-request.component.spec.ts: inspección
// directa del array de rutas, sin TestBed — no hace falta disparar los
// loadChildren() dinámicos para probar la forma de la config (spec
// "Guarded Lealtad Shell Routing" / "Unguarded Public Consulta Route").
describe('AppRoutingModule routes — sistema-lealtad', () => {
  function findIndex(path: string): number {
    return routes.findIndex(r => r.path === path);
  }

  it('registers /lealtad/consulta BEFORE /lealtad (D14 — first match must be the public one)', () => {
    const publicIdx = findIndex('lealtad/consulta');
    const staffIdx  = findIndex('lealtad');

    expect(publicIdx).toBeGreaterThan(-1);
    expect(staffIdx).toBeGreaterThan(-1);
    expect(publicIdx).toBeLessThan(staffIdx);
  });

  it('/lealtad/consulta has NO canActivate guard — renders for anonymous visitors', () => {
    const route = routes[findIndex('lealtad/consulta')];
    expect(route.canActivate).toBeUndefined();
  });

  it('/lealtad is gated by AuthGuard + PermissionGuard with data.permissions=["loyalty:read"]', () => {
    const route = routes[findIndex('lealtad')];
    expect(route.canActivate).toEqual([AuthGuard, PermissionGuard]);
    expect(route.data).toEqual({ permissions: ['loyalty:read'] });
  });

  it('both lealtad routes come before the wildcard fallback', () => {
    const wildcardIdx = findIndex('**');
    expect(findIndex('lealtad/consulta')).toBeLessThan(wildcardIdx);
    expect(findIndex('lealtad')).toBeLessThan(wildcardIdx);
  });

  it('espacios/kiosco (enlace directo del panel del kiosco) no lleva guards: el componente inicia sesión y regresa', () => {
    const route = routes[findIndex('espacios/kiosco')];
    expect(route.canActivate).toBeUndefined();
    expect(findIndex('espacios/kiosco')).toBeLessThan(routes.findIndex(r => r.path === '**'));
  });
});
