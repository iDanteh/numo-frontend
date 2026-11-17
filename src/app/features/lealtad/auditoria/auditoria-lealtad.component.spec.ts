import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AuditoriaLealtadComponent } from './auditoria-lealtad.component';
import { LoyaltyService, LoyaltySecurityEvent, LoyaltyKoreVentaLog } from '../../../core/services/loyalty.service';
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

function pagoKore(overrides: Partial<LoyaltyKoreVentaLog> = {}): LoyaltyKoreVentaLog {
  return {
    id: 1,
    endpoint: 'venta',
    payload: { serieFolio: 'A0-1' },
    resultado: 'exito',
    detalle: null,
    createdAt: '2026-11-17T10:00:00.000Z',
    ...overrides,
  };
}

describe('AuditoriaLealtadComponent', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let auth: jasmine.SpyObj<AuthService>;
  let comp: AuditoriaLealtadComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listarEventosSeguridad', 'listarVentasLogKore']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    loyalty.listarEventosSeguridad.and.returnValue(of({ total: 0, eventos: [] }));
    loyalty.listarVentasLogKore.and.returnValue(of({ total: 0, logs: [] }));
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

    // canVerPagosKore() usa el MISMO permiso que canVerEventos() (loyalty:auditoria) a propósito —
    // nunca hay un escenario real donde "eventos" esté oculta pero "pagos-kore" visible.
    it('con loyalty:auditoria, también puede ver "pagos-kore" (mismo permiso que "eventos")', () => {
      auth.hasPermission.and.callFake((p: string) => p === 'loyalty:auditoria');
      expect(comp.canVerPagosKore()).toBe(true);
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

  describe('cambiarPestana() carga pagos-kore la primera vez que se abre', () => {
    it('al cambiar a "pagos-kore" sin datos todavía, carga la lista', () => {
      comp.cambiarPestana('pagos-kore');
      expect(comp.pestana).toBe('pagos-kore');
      expect(loyalty.listarVentasLogKore).toHaveBeenCalled();
    });

    it('si ya había datos cargados, no vuelve a pedir la lista', () => {
      comp.pagosKore = [pagoKore()];
      comp.cambiarPestana('pagos-kore');
      expect(loyalty.listarVentasLogKore).not.toHaveBeenCalled();
    });
  });

  describe('cargarPagosKore()', () => {
    it('camino feliz: carga logs y total, apaga loading', () => {
      const log = pagoKore();
      loyalty.listarVentasLogKore.and.returnValue(of({ total: 1, logs: [log] }));

      comp.cargarPagosKore();

      expect(comp.pagosKore).toEqual([log]);
      expect(comp.totalPagos).toBe(1);
      expect(comp.loadingPagos).toBe(false);
      expect(comp.errorPagos).toBe('');
    });

    it('error: expone un mensaje y apaga loading', () => {
      loyalty.listarVentasLogKore.and.returnValue(throwError(() => ({ error: { error: 'boom' } })));
      comp.cargarPagosKore();
      expect(comp.errorPagos).toBe('boom');
      expect(comp.loadingPagos).toBe(false);
    });

    it('manda los filtros vacíos como undefined al service', () => {
      comp.cargarPagosKore();
      expect(loyalty.listarVentasLogKore).toHaveBeenCalledWith(jasmine.objectContaining({
        resultado: undefined, endpoint: undefined, desde: undefined, hasta: undefined,
        limit: comp.LIMIT, offset: 0,
      }));
    });
  });

  describe('aplicarFiltrosPagos() / limpiarFiltrosPagos()', () => {
    it('aplicarFiltrosPagos() reinicia la paginación a 0', () => {
      comp.offsetPagos = 100;
      comp.aplicarFiltrosPagos();
      expect(comp.offsetPagos).toBe(0);
      expect(loyalty.listarVentasLogKore).toHaveBeenCalled();
    });

    it('limpiarFiltrosPagos() borra todos los filtros', () => {
      comp.resultadoPagos = 'error';
      comp.endpointPagos = 'ventas';
      comp.desdePagos = '2026-11-01';
      comp.hastaPagos = '2026-11-17';

      comp.limpiarFiltrosPagos();

      expect(comp.resultadoPagos).toBe('');
      expect(comp.endpointPagos).toBe('');
      expect(comp.desdePagos).toBe('');
      expect(comp.hastaPagos).toBe('');
    });
  });

  describe('onRangoPagos()', () => {
    it('setea desde/hasta y vuelve a pedir la lista', () => {
      comp.onRangoPagos({ fechaInicio: '2026-11-01', fechaFin: '2026-11-17' });
      expect(comp.desdePagos).toBe('2026-11-01');
      expect(comp.hastaPagos).toBe('2026-11-17');
      expect(loyalty.listarVentasLogKore).toHaveBeenCalled();
    });
  });

  describe('paginación de pagos-kore', () => {
    it('paginaSiguientePagos() avanza el offset si hay más páginas', () => {
      comp.totalPagos = 120;
      comp.offsetPagos = 0;
      comp.paginaSiguientePagos();
      expect(comp.offsetPagos).toBe(comp.LIMIT);
    });

    it('paginaSiguientePagos() no hace nada si ya se llegó al final', () => {
      comp.totalPagos = 10;
      comp.offsetPagos = 0;
      comp.paginaSiguientePagos();
      expect(comp.offsetPagos).toBe(0);
    });

    it('paginaAnteriorPagos() retrocede sin bajar de 0', () => {
      comp.offsetPagos = comp.LIMIT;
      comp.paginaAnteriorPagos();
      expect(comp.offsetPagos).toBe(0);
      comp.paginaAnteriorPagos();
      expect(comp.offsetPagos).toBe(0);
    });
  });

  describe('toggleExpandirPago() / payloadFormateado()', () => {
    it('toggleExpandirPago() agrega y quita el id del set de expandidos', () => {
      expect(comp.pagosExpandidos.has(7)).toBe(false);
      comp.toggleExpandirPago(7);
      expect(comp.pagosExpandidos.has(7)).toBe(true);
      comp.toggleExpandirPago(7);
      expect(comp.pagosExpandidos.has(7)).toBe(false);
    });

    it('payloadFormateado() devuelve el JSON indentado', () => {
      expect(comp.payloadFormateado({ serieFolio: 'A0-1' })).toBe(JSON.stringify({ serieFolio: 'A0-1' }, null, 2));
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
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listarEventosSeguridad', 'listarVentasLogKore']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    loyalty.listarEventosSeguridad.and.returnValue(of({ total: 0, eventos: [] }));
    loyalty.listarVentasLogKore.and.returnValue(of({ total: 0, logs: [] }));
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

  it('con loyalty:auditoria Y loyalty:config, muestra las 4 pestañas', async () => {
    await montar(['loyalty:auditoria', 'loyalty:config']);
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Eventos OTP');
    expect(texto).toContain('Ventas fallidas');
    expect(texto).toContain('Ventas canceladas');
    expect(texto).toContain('Pagos Kore');
  });

  it('SOLO con loyalty:config, oculta "Eventos OTP" y "Pagos Kore" (mismo permiso: loyalty:auditoria)', async () => {
    await montar(['loyalty:config']);
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).not.toContain('Eventos OTP');
    expect(texto).not.toContain('Pagos Kore');
  });

  it('pestaña "Pagos Kore": renderiza fecha/endpoint/resultado, payload colapsado por default, se expande al hacer clic', async () => {
    await montar(['loyalty:auditoria']);
    loyalty.listarVentasLogKore.and.returnValue(of({
      total: 1,
      logs: [{
        id: 9, endpoint: 'ventas', payload: { ventas: [{ serieFolio: 'A0-1' }] }, resultado: 'error', detalle: 'La venta no existe en Kore.', createdAt: '2026-11-17T10:00:00.000Z',
      }],
    }));
    fixture.detectChanges();
    fixture.componentInstance.cambiarPestana('pagos-kore');
    fixture.detectChanges();

    let texto = fixture.nativeElement.textContent;
    expect(texto).toContain('/ventas (lote)');
    expect(texto).toContain('La venta no existe en Kore.');
    expect(texto).not.toContain('serieFolio'); // colapsado: el payload crudo no está en el DOM todavía

    fixture.nativeElement.querySelector('.al-row-clickable').click();
    fixture.detectChanges();

    texto = fixture.nativeElement.textContent;
    expect(texto).toContain('serieFolio'); // expandido: ahora sí aparece el payload crudo
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
