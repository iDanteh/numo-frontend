import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AuditoriaLealtadComponent } from './auditoria-lealtad.component';
import { LoyaltyService, LoyaltySecurityEvent } from '../../../core/services/loyalty.service';
import { AuthService } from '../../../core/services/auth.service';

function evento(overrides: Partial<LoyaltySecurityEvent> = {}): LoyaltySecurityEvent {
  return {
    id: 1,
    telefono: '5512345678',
    tipo: 'solicitud_codigo_canje',
    resultado: 'exito',
    motivo: null,
    ip: null,
    createdAt: '2026-11-13T10:00:00.000Z',
    ...overrides,
  };
}

describe('AuditoriaLealtadComponent', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let auth: jasmine.SpyObj<AuthService>;
  let comp: AuditoriaLealtadComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listarEventosSeguridad']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    loyalty.listarEventosSeguridad.and.returnValue(of({ total: 0, eventos: [] }));
    auth.hasPermission.and.returnValue(true); // default: todos los permisos, como admin
    comp = new AuditoriaLealtadComponent(loyalty, auth);
  });

  describe('ngOnInit() — arranca en la pestaña correcta según permisos', () => {
    it('con loyalty:auditoria, arranca en "eventos" y carga la lista', () => {
      comp.ngOnInit();
      expect(comp.pestana).toBe('eventos');
      expect(loyalty.listarEventosSeguridad).toHaveBeenCalled();
    });

    it('SIN loyalty:auditoria pero con loyalty:config, arranca en "ventas-fallidas" sin llamar al service de eventos', () => {
      auth.hasPermission.and.callFake((p: string) => p === 'loyalty:config');
      comp.ngOnInit();
      expect(comp.pestana).toBe('ventas-fallidas');
      expect(loyalty.listarEventosSeguridad).not.toHaveBeenCalled();
    });

    it('sin ningún permiso, no carga nada y no rompe (las pestañas quedan ocultas en el template)', () => {
      auth.hasPermission.and.returnValue(false);
      expect(() => comp.ngOnInit()).not.toThrow();
      expect(loyalty.listarEventosSeguridad).not.toHaveBeenCalled();
    });
  });

  describe('cargarEventos()', () => {
    it('camino feliz: carga eventos y total, apaga loading', () => {
      const ev = evento();
      loyalty.listarEventosSeguridad.and.returnValue(of({ total: 1, eventos: [ev] }));

      comp.cargarEventos();

      expect(comp.eventos).toEqual([ev]);
      expect(comp.total).toBe(1);
      expect(comp.loading).toBe(false);
      expect(comp.error).toBe('');
    });

    it('error: expone un mensaje y apaga loading', () => {
      loyalty.listarEventosSeguridad.and.returnValue(throwError(() => ({ error: { error: 'boom' } })));
      comp.cargarEventos();
      expect(comp.error).toBe('boom');
      expect(comp.loading).toBe(false);
    });

    it('manda los filtros vacíos como undefined (nunca strings vacíos) al service', () => {
      comp.telefono = '  5512345678  ';
      comp.cargarEventos();

      expect(loyalty.listarEventosSeguridad).toHaveBeenCalledWith(jasmine.objectContaining({
        telefono: '5512345678',
        tipo: undefined,
        resultado: undefined,
        desde: undefined,
        hasta: undefined,
        limit: comp.LIMIT,
        offset: 0,
      }));
    });
  });

  describe('aplicarFiltros() / limpiarFiltros()', () => {
    it('aplicarFiltros() reinicia la paginación a 0', () => {
      comp.offset = 100;
      comp.aplicarFiltros();
      expect(comp.offset).toBe(0);
      expect(loyalty.listarEventosSeguridad).toHaveBeenCalled();
    });

    it('limpiarFiltros() borra todos los filtros y recarga', () => {
      comp.telefono = '5512345678';
      comp.tipo = 'confirmacion_codigo_canje';
      comp.resultado = 'fallo';
      comp.desde = '2026-11-01';
      comp.hasta = '2026-11-13';

      comp.limpiarFiltros();

      expect(comp.telefono).toBe('');
      expect(comp.tipo).toBe('');
      expect(comp.resultado).toBe('');
      expect(comp.desde).toBe('');
      expect(comp.hasta).toBe('');
    });
  });

  describe('onRango()', () => {
    it('setea desde/hasta y vuelve a pedir la lista', () => {
      comp.onRango({ fechaInicio: '2026-11-01', fechaFin: '2026-11-13' });
      expect(comp.desde).toBe('2026-11-01');
      expect(comp.hasta).toBe('2026-11-13');
      expect(loyalty.listarEventosSeguridad).toHaveBeenCalled();
    });
  });

  describe('paginación', () => {
    it('paginaSiguiente() avanza el offset si hay más páginas', () => {
      comp.total = 120;
      comp.offset = 0;
      comp.paginaSiguiente();
      expect(comp.offset).toBe(comp.LIMIT);
    });

    it('paginaSiguiente() no hace nada si ya se llegó al final', () => {
      comp.total = 10;
      comp.offset = 0;
      comp.paginaSiguiente();
      expect(comp.offset).toBe(0);
    });

    it('paginaAnterior() retrocede sin bajar de 0', () => {
      comp.offset = comp.LIMIT;
      comp.paginaAnterior();
      expect(comp.offset).toBe(0);
      comp.paginaAnterior();
      expect(comp.offset).toBe(0);
    });
  });

  describe('tipoLabel()', () => {
    it('devuelve la etiqueta amigable de un tipo conocido', () => {
      expect(comp.tipoLabel('solicitud_codigo_canje')).toBe('Solicitud de código de canje');
    });
  });
});

/**
 * Template real (TestBed) — mismo criterio que VentasFallidasLealtadComponent: confirma que las
 * pestañas respetan el permiso real y que la tabla de eventos nunca expone el código OTP (no existe
 * en el modelo, pero se verifica igual que el texto renderizado no lo sugiere).
 */
describe('AuditoriaLealtadComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<AuditoriaLealtadComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let auth: jasmine.SpyObj<AuthService>;

  async function montar(permisos: string[]): Promise<void> {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listarEventosSeguridad']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    loyalty.listarEventosSeguridad.and.returnValue(of({ total: 0, eventos: [] }));
    auth.hasPermission.and.callFake((p: string) => permisos.includes(p));

    await TestBed.configureTestingModule({
      declarations: [AuditoriaLealtadComponent],
      providers: [
        { provide: LoyaltyService, useValue: loyalty },
        { provide: AuthService, useValue: auth },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(AuditoriaLealtadComponent);
  }

  it('con loyalty:auditoria Y loyalty:config, muestra las 3 pestañas', async () => {
    await montar(['loyalty:auditoria', 'loyalty:config']);
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Eventos OTP');
    expect(texto).toContain('Ventas fallidas');
    expect(texto).toContain('Ventas canceladas');
  });

  it('SOLO con loyalty:config, oculta la pestaña "Eventos OTP"', async () => {
    await montar(['loyalty:config']);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Eventos OTP');
  });

  it('renderiza un evento con su teléfono, tipo y badge de resultado, nunca un código de 6 dígitos', async () => {
    await montar(['loyalty:auditoria']);
    loyalty.listarEventosSeguridad.and.returnValue(of({
      total: 1,
      eventos: [evento({ telefono: '5512345678', tipo: 'confirmacion_codigo_canje', resultado: 'fallo', motivo: 'codigo incorrecto' })],
    }));
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('5512345678');
    expect(texto).toContain('Confirmación de código de canje');
    expect(texto).toContain('Fallo');
    expect(texto).toContain('codigo incorrecto');
    expect(texto).not.toMatch(/\b\d{6}\b/); // ningún código OTP de 6 dígitos en pantalla
  });

  it('sin eventos, muestra el mensaje vacío', async () => {
    await montar(['loyalty:auditoria']);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin eventos para estos filtros.');
  });
});
