import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { AuthModule } from '@auth0/auth0-angular';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        // Ruta comodín: solo necesitamos que el Router pueda RESOLVER
        // cualquier URL de prueba (NavigationEnd dispara updateLayout()) —
        // el componente destino no importa, AppComponent mismo alcanza.
        RouterModule.forRoot([{ path: '**', component: AppComponent }]),
        // AppComponent inyecta AuthService (@auth0/auth0-angular), que a su vez
        // depende de HttpClient — sin AuthModule.forRoot() + HttpClientTestingModule
        // la inyección falla con NullInjectorError. domain/clientId dummy y
        // HttpClientTestingModule: no se hace login real ni llamadas de red.
        HttpClientTestingModule,
        AuthModule.forRoot({ domain: 'ci-dummy.auth0.com', clientId: 'ci-dummy-client-id' }),
      ],
      declarations: [
        AppComponent
      ],
      // El template real usa componentes de SharedModule (ej. app-toast) que
      // este test no necesita renderizar — solo importa que AppComponent se
      // instancie sin explotar.
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    router = TestBed.inject(Router);
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  // ── sistema-lealtad PR5 — RED first: AppComponent does not yet inject
  // Router/track NavigationEnd, so showGlobalSidebar/isPublicLealtad do not
  // exist yet (spec "Route-Aware Sidebar Suppression" / "Unguarded Public
  // Consulta Route"). These assertions reference the fields that GREEN must add.
  it('showGlobalSidebar starts true (no Lealtad route visited yet)', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.showGlobalSidebar).toBe(true);
    expect(app.isPublicLealtad).toBe(false);
  });

  it('suppresses the global sidebar after navigating to any /lealtad/** URL', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    await router.navigateByUrl('/lealtad/tarjetas');
    fixture.detectChanges();

    expect(app.showGlobalSidebar).toBe(false);
    expect(app.isPublicLealtad).toBe(false);
  });

  it('does NOT suppress the sidebar for an unrelated route (e.g. /users)', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    await router.navigateByUrl('/lealtad/tarjetas'); // suppress first
    await router.navigateByUrl('/users');             // then move away
    fixture.detectChanges();

    expect(app.showGlobalSidebar).toBe(true);
  });

  it('marks isPublicLealtad true on /lealtad/consulta — renders without the staff layout even if authenticated', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    await router.navigateByUrl('/lealtad/consulta');
    fixture.detectChanges();

    expect(app.isPublicLealtad).toBe(true);
    expect(app.showGlobalSidebar).toBe(false);
  });

  it('isPublicLealtad is false again after leaving /lealtad/consulta for a nested staff Lealtad route', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    await router.navigateByUrl('/lealtad/consulta');
    // 2026-10-16: /lealtad/configuracion ya no existe como ruta propia (ver
    // lealtad-routing.module.ts) — /lealtad/config es la ruta espejo real que
    // la reemplaza (Administración → Configuraciones Globales sin salir de
    // Lealtad). Esta prueba solo necesita CUALQUIER ruta anidada bajo /lealtad.
    await router.navigateByUrl('/lealtad/config');
    fixture.detectChanges();

    expect(app.isPublicLealtad).toBe(false);
    expect(app.showGlobalSidebar).toBe(false); // still suppressed — it's under /lealtad/**
  });
});
