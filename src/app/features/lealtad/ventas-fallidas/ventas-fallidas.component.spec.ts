import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { VentasFallidasLealtadComponent } from './ventas-fallidas.component';
import { LoyaltyService, LoyaltyKoreVentaFallida } from '../../../core/services/loyalty.service';

function venta(overrides: Partial<LoyaltyKoreVentaFallida> = {}): LoyaltyKoreVentaFallida {
  return {
    id: 1,
    serieFolio: 'A0-260605320',
    payloadRecibido: JSON.stringify({ foo: 'bar' }),
    motivo: 'Concepto de Kore sin configurar',
    intentos: 1,
    resuelto: false,
    resueltoPorUserId: null,
    resueltoPorNombre: null,
    resueltoEn: null,
    createdAt: '2026-11-03T12:00:00.000Z',
    updatedAt: '2026-11-03T12:00:00.000Z',
    ...overrides,
  };
}

describe('VentasFallidasLealtadComponent', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let comp: VentasFallidasLealtadComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'listarVentasFallidas', 'marcarVentaFallidaResuelta',
    ]);
    loyalty.listarVentasFallidas.and.returnValue(of([]));
    comp = new VentasFallidasLealtadComponent(loyalty);
  });

  describe('cargar() / ngOnInit()', () => {
    it('arranca con soloNoResueltas=true (default) y lo manda al servicio', () => {
      comp.ngOnInit();
      expect(loyalty.listarVentasFallidas).toHaveBeenCalledWith(true);
    });

    it('camino feliz: carga la lista y apaga loading', () => {
      const v = venta();
      loyalty.listarVentasFallidas.and.returnValue(of([v]));

      comp.ngOnInit();

      expect(comp.ventas).toEqual([v]);
      expect(comp.loading).toBe(false);
      expect(comp.error).toBe('');
    });

    it('error: expone un mensaje y apaga loading', () => {
      loyalty.listarVentasFallidas.and.returnValue(throwError(() => ({ error: { error: 'boom' } })));
      comp.ngOnInit();
      expect(comp.error).toBe('boom');
      expect(comp.loading).toBe(false);
    });
  });

  describe('cambiarFiltro()', () => {
    it('cambia soloNoResueltas y vuelve a cargar', () => {
      comp.ngOnInit();
      loyalty.listarVentasFallidas.calls.reset();

      comp.cambiarFiltro(false);

      expect(comp.soloNoResueltas).toBe(false);
      expect(loyalty.listarVentasFallidas).toHaveBeenCalledWith(false);
    });

    it('no vuelve a cargar si el filtro ya es el mismo', () => {
      comp.ngOnInit();
      loyalty.listarVentasFallidas.calls.reset();

      comp.cambiarFiltro(true);

      expect(loyalty.listarVentasFallidas).not.toHaveBeenCalled();
    });

    it('cierra el detalle expandido al cambiar de filtro', () => {
      comp.expandedId = 5;
      comp.cambiarFiltro(false);
      expect(comp.expandedId).toBeNull();
    });
  });

  describe('toggleDetalle()', () => {
    it('abre y cierra el detalle de la misma fila (toggle)', () => {
      comp.toggleDetalle(1);
      expect(comp.expandedId).toBe(1);
      comp.toggleDetalle(1);
      expect(comp.expandedId).toBeNull();
    });

    it('cambiar a otra fila reemplaza la expandida (un solo detalle a la vez)', () => {
      comp.toggleDetalle(1);
      comp.toggleDetalle(2);
      expect(comp.expandedId).toBe(2);
    });
  });

  describe('payloadFormateado()', () => {
    it('JSON válido: lo re-formatea con indentación', () => {
      const v = venta({ payloadRecibido: '{"a":1,"b":2}' });
      expect(comp.payloadFormateado(v)).toBe(JSON.stringify({ a: 1, b: 2 }, null, 2));
    });

    it('JSON inválido: devuelve el string crudo sin romper (try/catch)', () => {
      const v = venta({ payloadRecibido: 'no es json {' });
      expect(comp.payloadFormateado(v)).toBe('no es json {');
    });
  });

  describe('marcarResuelto() / confirmarResolver() — vía app-confirm-modal, no confirm() nativo', () => {
    it('marcarResuelto() solo abre el modal, no llama al servicio todavía', () => {
      const v = venta();
      comp.marcarResuelto(v);

      expect(comp.confirmResolverVenta).toBe(v);
      expect(loyalty.marcarVentaFallidaResuelta).not.toHaveBeenCalled();
    });

    it('cerrarConfirmResolver() cancela sin llamar al servicio', () => {
      const v = venta();
      comp.marcarResuelto(v);

      comp.cerrarConfirmResolver();

      expect(comp.confirmResolverVenta).toBeNull();
      expect(loyalty.marcarVentaFallidaResuelta).not.toHaveBeenCalled();
    });

    it('confirmResolverMsg escapa el serieFolio (texto libre del body de Kore) antes de interpolarlo', () => {
      const v = venta({ serieFolio: '<a href="http://evil.example">x</a>' });
      comp.marcarResuelto(v);

      expect(comp.confirmResolverMsg).not.toContain('<a href');
      expect(comp.confirmResolverMsg).toContain('&lt;a href');
    });

    it('camino feliz con soloNoResueltas=true: quita la venta de la lista (ya no matchea el filtro)', () => {
      const v = venta({ id: 7 });
      comp.ventas = [v, venta({ id: 8 })];
      comp.soloNoResueltas = true;
      loyalty.marcarVentaFallidaResuelta.and.returnValue(of({ ...v, resuelto: true, resueltoPorNombre: 'Ana' }));

      comp.marcarResuelto(v);
      comp.confirmarResolver();

      expect(loyalty.marcarVentaFallidaResuelta).toHaveBeenCalledWith(7);
      expect(comp.confirmResolverVenta).toBeNull();
      expect(comp.ventas.map((x) => x.id)).toEqual([8]);
      expect(comp.resolviendo[7]).toBeUndefined();
    });

    it('camino feliz con soloNoResueltas=false ("Todas"): actualiza la fila en vez de quitarla', () => {
      const v = venta({ id: 7 });
      comp.ventas = [v];
      comp.soloNoResueltas = false;
      const actualizada = { ...v, resuelto: true, resueltoPorNombre: 'Ana' };
      loyalty.marcarVentaFallidaResuelta.and.returnValue(of(actualizada));

      comp.marcarResuelto(v);
      comp.confirmarResolver();

      expect(comp.ventas).toEqual([actualizada]);
    });

    it('cierra el detalle expandido si era el de la venta recién resuelta', () => {
      const v = venta({ id: 7 });
      comp.ventas = [v];
      comp.expandedId = 7;
      loyalty.marcarVentaFallidaResuelta.and.returnValue(of({ ...v, resuelto: true }));

      comp.marcarResuelto(v);
      comp.confirmarResolver();

      expect(comp.expandedId).toBeNull();
    });

    it('error del backend: muestra el mensaje de error y apaga el spinner, sin tocar la lista', () => {
      const v = venta({ id: 7 });
      comp.ventas = [v];
      loyalty.marcarVentaFallidaResuelta.and.returnValue(throwError(() => ({ error: { error: 'no se pudo' } })));

      comp.marcarResuelto(v);
      comp.confirmarResolver();

      expect(comp.error).toBe('no se pudo');
      expect(comp.resolviendo[7]).toBeUndefined();
      expect(comp.ventas).toEqual([v]);
    });
  });
});

/**
 * Template real (TestBed) — mismo criterio que ClientesPendientesComponent/LealtadShellComponent:
 * confirma que la tabla, el badge de estado y el toggle de filtro realmente se reflejan en el DOM.
 * NO_ERRORS_SCHEMA ignora app-confirm-modal (no es relevante acá).
 */
describe('VentasFallidasLealtadComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<VentasFallidasLealtadComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'listarVentasFallidas', 'marcarVentaFallidaResuelta',
    ]);
    loyalty.listarVentasFallidas.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      declarations: [VentasFallidasLealtadComponent],
      providers: [{ provide: LoyaltyService, useValue: loyalty }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(VentasFallidasLealtadComponent);
  });

  it('sin ventas: muestra el mensaje vacío correspondiente al filtro activo', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin ventas pendientes de resolver.');
  });

  it('renderiza serieFolio, motivo, intentos y el badge "Pendiente" de una venta sin resolver', () => {
    loyalty.listarVentasFallidas.and.returnValue(of([venta({ serieFolio: 'A0-999', motivo: 'Forma de pago sin configurar', intentos: 3 })]));
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('A0-999');
    expect(texto).toContain('Forma de pago sin configurar');
    expect(texto).toContain('3');
    expect(texto).toContain('Pendiente');
  });

  it('una venta resuelta muestra el badge "Resuelto" y no muestra el botón de acción', () => {
    loyalty.listarVentasFallidas.and.returnValue(of([venta({ resuelto: true, resueltoPorNombre: 'Ana' })]));
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Resuelto');
    expect(texto).toContain('Ana');
    expect(fixture.nativeElement.querySelector('.btn-primary')).toBeFalsy();
  });

  it('"Ver detalle" expande la fila y muestra el payload formateado', () => {
    loyalty.listarVentasFallidas.and.returnValue(of([venta({ id: 3, payloadRecibido: '{"x":1}' })]));
    fixture.detectChanges();

    const btn: HTMLButtonElement = Array.from(fixture.nativeElement.querySelectorAll('.vf-detalle-btn'))
      .find((b: any) => b.textContent.includes('Ver detalle')) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    fixture.detectChanges();

    const pre = fixture.nativeElement.querySelector('.vf-payload');
    expect(pre).toBeTruthy();
    expect(pre.textContent).toContain('"x": 1');
  });

  it('click en "Todas" vuelve a pedir la lista sin el filtro de no resueltas', () => {
    fixture.detectChanges();
    loyalty.listarVentasFallidas.calls.reset();

    const btns: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.vf-filter-btn'));
    const todas = btns.find((b) => b.textContent?.includes('Todas'))!;
    todas.click();
    fixture.detectChanges();

    expect(loyalty.listarVentasFallidas).toHaveBeenCalledWith(false);
  });
});
