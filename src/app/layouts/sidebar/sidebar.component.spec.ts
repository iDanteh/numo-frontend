import { SidebarComponent } from './sidebar.component';
import { AuthService } from '../../core/services/auth.service';
import { TransitionOverlayService } from '../../shared/components/transition-overlay/transition-overlay.service';
import { ADMINISTRACION_NAV } from '../../shared/config/administracion-nav.config';

// Componente instanciado directo (sin TestBed) para la lógica nueva — mismo
// criterio que CollectionRequestComponent/LealtadShellComponent: gating por
// permiso y orden overlay→navegación son lógica pura.
describe('SidebarComponent — sistema-lealtad (shared Administración + space-switcher)', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<any>;
  let overlay: jasmine.SpyObj<TransitionOverlayService>;
  let comp: SidebarComponent;

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    router = jasmine.createSpyObj('Router', ['navigateByUrl'], { url: '/banks' });
    overlay = jasmine.createSpyObj<TransitionOverlayService>('TransitionOverlayService', ['play']);
    overlay.play.and.returnValue(Promise.resolve());
    comp = new SidebarComponent(auth, router, overlay);
  });

  it('sources its "Administración" section from the exact shared ADMINISTRACION_NAV config (spec: identical entries across both shells)', () => {
    const adminSection = comp.sections.find(s => s.label === 'Administración');
    expect(adminSection).toBe(ADMINISTRACION_NAV);
  });

  it('canSwitchToLealtad(): false without loyalty:read', () => {
    auth.hasPermission.and.returnValue(false);
    expect(comp.canSwitchToLealtad()).toBe(false);
  });

  it('canSwitchToLealtad(): true with loyalty:read — gates the clickable logo (spec "Space-Switcher Navigation")', () => {
    auth.hasPermission.and.callFake((p: string) => p === 'loyalty:read');
    expect(comp.canSwitchToLealtad()).toBe(true);
  });

  it('switchToLealtad(): plays the "to-lealtad" transition BEFORE navigating to /lealtad', async () => {
    const callOrder: string[] = [];
    overlay.play.and.callFake((v: any) => { callOrder.push(`play:${v}`); return Promise.resolve(); });
    router.navigateByUrl.and.callFake((url: string) => { callOrder.push(`nav:${url}`); return Promise.resolve(true); });

    await comp.switchToLealtad();

    expect(overlay.play).toHaveBeenCalledWith('to-lealtad');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/lealtad');
    expect(callOrder).toEqual(['play:to-lealtad', 'nav:/lealtad']);
  });
});
