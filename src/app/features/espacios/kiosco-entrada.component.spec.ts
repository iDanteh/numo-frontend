import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { EspaciosService } from '../../core/services/espacios.service';
import { KioscoEntradaComponent } from './kiosco-entrada.component';

describe('KioscoEntradaComponent (enlace directo al panel del kiosco)', () => {
  let auth: any;
  let espacios: jasmine.SpyObj<EspaciosService>;
  let router: jasmine.SpyObj<Router>;

  function crear(autenticado: boolean, permisos: string[]) {
    auth = {
      isLoading$: new BehaviorSubject(false),
      isAuthenticated$: new BehaviorSubject(autenticado),
      roleLoaded$: new BehaviorSubject(true),
      isSessionExpired: () => false,
      hasPermission: (p: string) => permisos.includes(p),
      login: jasmine.createSpy('login'),
    };
    espacios = jasmine.createSpyObj<EspaciosService>('EspaciosService', ['pase', 'irA']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    TestBed.configureTestingModule({
      imports: [KioscoEntradaComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: EspaciosService, useValue: espacios },
        { provide: Router, useValue: router },
      ],
    });
    return TestBed.createComponent(KioscoEntradaComponent).componentInstance;
  }

  it('sin sesión manda a iniciar sesión y pide regresar a esta misma página', async () => {
    const c = crear(false, []);
    await c.ngOnInit();
    expect(auth.login).toHaveBeenCalledWith('/espacios/kiosco');
    expect(espacios.pase).not.toHaveBeenCalled();
  });

  it('sin kiosco:admin no pide pase: acceso denegado', async () => {
    const c = crear(true, ['banks:read']);
    await c.ngOnInit();
    expect(router.navigate).toHaveBeenCalledWith(['/unauthorized']);
    expect(espacios.pase).not.toHaveBeenCalled();
  });

  it('con sesión y kiosco:admin pide el pase y se va al panel', async () => {
    const c = crear(true, ['kiosco:admin']);
    espacios.pase.and.returnValue(Promise.resolve('https://kiosko-pruebas.tubosyconexiones.mx/admin/login#pase=a.b.c'));
    await c.ngOnInit();
    expect(espacios.pase).toHaveBeenCalledWith('/espacios/kiosco/pase');
    expect(espacios.irA).toHaveBeenCalledWith('https://kiosko-pruebas.tubosyconexiones.mx/admin/login#pase=a.b.c');
  });

  it('si NUMO no da el pase, muestra el error y deja reintentar', async () => {
    const c = crear(true, ['kiosco:admin']);
    espacios.pase.and.returnValue(Promise.reject(new Error('503')));
    await c.ngOnInit();
    expect(c.error).toContain('Kiosco de facturación');
    expect(espacios.irA).not.toHaveBeenCalled();
  });
});
