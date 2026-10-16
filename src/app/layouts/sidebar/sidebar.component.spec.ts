import { SidebarComponent } from './sidebar.component';
import { AuthService } from '../../core/services/auth.service';
import { ADMINISTRACION_NAV } from '../../shared/config/administracion-nav.config';

// Componente instanciado directo (sin TestBed) para la lógica nueva — mismo
// criterio que CollectionRequestComponent/LealtadShellComponent: gating por
// permiso es lógica pura. La navegación entre espacios (antes
// switchToLealtad()/canSwitchToLealtad() acá) ahora vive en
// SpaceSwitcherComponent (shared/components/space-switcher/), que SidebarComponent
// solo monta con currentSpaceId="numo" — ver sus propios specs.
describe('SidebarComponent — sistema-lealtad (shared Administración)', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<any>;
  let comp: SidebarComponent;

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    router = jasmine.createSpyObj('Router', ['navigateByUrl'], { url: '/banks' });
    comp = new SidebarComponent(auth, router);
  });

  it('sources its "Administración" section from the exact shared ADMINISTRACION_NAV config (spec: identical entries across both shells)', () => {
    const adminSection = comp.sections.find(s => s.label === 'Administración');
    expect(adminSection).toBe(ADMINISTRACION_NAV);
  });
});
