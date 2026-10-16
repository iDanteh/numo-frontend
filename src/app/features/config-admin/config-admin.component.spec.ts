import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, Subject } from 'rxjs';
import { ConfigAdminComponent } from './config-admin.component';
import { ConfigService } from '../../core/services/config.service';
import { SocketService } from '../../core/services/socket.service';
import { AuthService } from '../../core/services/auth.service';
import { ConfigSection, GlobalConfig } from '../../core/models/config.model';

/**
 * 2026-10-16 — "Central de configuración" centraliza acá la sección
 * "Lealtad" (ver config-admin.component.ts: viewingLealtad/showLealtad()/
 * seleccionarLealtad()). NO es una ConfigSection genérica del backend — está
 * gateada por loyalty:config (no por config:manage, el resto de esta
 * pantalla) y su contenido real es <app-lealtad-config>, probado aparte en
 * lealtad-config.component.spec.ts. Acá solo se cubre el *wiring* del rail:
 * visibilidad por permiso y el cambio de panel derecho.
 *
 * Mismo criterio que lealtad-shell.component.spec.ts: un bloque con TestBed
 * que SÍ dispara fixture.detectChanges() sobre el template real (gap real ya
 * encontrado en este proyecto — Karma no atrapa errores de template que no
 * fuerzan el render), más un bloque de lógica directa sin TestBed.
 */
const SECTION: ConfigSection = {
  id: 1, clave: 'smtp', nombre: 'Correo (SMTP)', descripcion: null,
  modulosAfectados: [], createdAt: '', updatedAt: '',
};
const CONFIG: GlobalConfig = {
  id: 10, sectionId: 1, clave: 'HOST', valor: 'smtp.example.com', esSecreto: false,
  tipo: 'texto', descripcion: null, updatedBy: null, updatedAt: new Date().toISOString(),
};

function crearConfigSvcSpy(sections: ConfigSection[] = [SECTION]): jasmine.SpyObj<ConfigService> {
  const svc = jasmine.createSpyObj<ConfigService>('ConfigService', [
    'listSections', 'listConfigsBySection', 'setValue', 'revealSecret', 'listAuditLog',
    'createSection', 'updateSection',
  ]);
  svc.listSections.and.returnValue(of(sections));
  svc.listConfigsBySection.and.returnValue(of(sections.length ? [CONFIG] : []));
  return svc;
}

function crearSocketStub(): any {
  return { configUpdated$: new Subject() };
}

describe('ConfigAdminComponent — template real (TestBed, detecta bindings rotos)', () => {
  let fixture: ComponentFixture<ConfigAdminComponent>;
  let auth: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    auth.hasPermission.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [ConfigAdminComponent],
      providers: [
        { provide: ConfigService, useValue: crearConfigSvcSpy() },
        { provide: SocketService, useValue: crearSocketStub() },
        { provide: AuthService, useValue: auth },
      ],
      // <app-lealtad-config> se reusa de LealtadConfigModule — acá no hace
      // falta montarlo completo (con su propio LoyaltyService/SocketService),
      // el wiring del rail es lo que se prueba en este archivo.
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfigAdminComponent);
  });

  it('renders the console with the "Lealtad" rail entry without throwing', () => {
    expect(() => fixture.detectChanges()).not.toThrow();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Lealtad');
    expect(text).toContain('Correo (SMTP)');
  });

  it('clicking the "Lealtad" rail entry swaps the detail panel to <app-lealtad-config>', () => {
    fixture.detectChanges();
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.cfg-rail-item'));
    const lealtadBtn = buttons.find(b => b.textContent?.includes('Lealtad'));
    expect(lealtadBtn).toBeTruthy();

    lealtadBtn!.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-lealtad-config')).toBeTruthy();
    expect(fixture.componentInstance.viewingLealtad).toBe(true);
  });

  it('hides the "Lealtad" rail entry when the user lacks loyalty:config', () => {
    auth.hasPermission.and.returnValue(false);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Lealtad');
  });
});

describe('ConfigAdminComponent (lógica directa)', () => {
  let configSvc: jasmine.SpyObj<ConfigService>;
  let socket: any;
  let auth: jasmine.SpyObj<AuthService>;
  let comp: ConfigAdminComponent;

  beforeEach(() => {
    configSvc = crearConfigSvcSpy();
    socket = crearSocketStub();
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    comp = new ConfigAdminComponent(configSvc, socket, auth);
  });

  it('showLealtad(): reflects auth.hasPermission(\'loyalty:config\') specifically, not config:manage', () => {
    auth.hasPermission.and.callFake((p: string) => p === 'loyalty:config');
    expect(comp.showLealtad()).toBe(true);
    expect(auth.hasPermission).toHaveBeenCalledWith('loyalty:config');

    auth.hasPermission.and.callFake((p: string) => p === 'config:manage');
    expect(comp.showLealtad()).toBe(false);
  });

  it('seleccionarLealtad(): activates the Lealtad panel and clears the selected generic section', () => {
    comp.ngOnInit();
    comp.selectedSection = SECTION;
    comp.seleccionarLealtad();
    expect(comp.viewingLealtad).toBe(true);
    expect(comp.selectedSection).toBeNull();
  });

  it('seleccionar(): picking a generic section again leaves the Lealtad panel', () => {
    comp.ngOnInit();
    comp.seleccionarLealtad();
    comp.seleccionar(SECTION);
    expect(comp.viewingLealtad).toBe(false);
    expect(comp.selectedSection).toBe(SECTION);
  });
});
