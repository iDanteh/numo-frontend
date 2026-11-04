import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { VentasCanceladasAuditoriaLealtadComponent } from './ventas-canceladas-auditoria.component';
import { LoyaltyService, LoyaltyKoreVentaCanceladaConDeposito } from '../../../core/services/loyalty.service';

function venta(overrides: Partial<LoyaltyKoreVentaCanceladaConDeposito> = {}): LoyaltyKoreVentaCanceladaConDeposito {
  return {
    cardId: 'card-uuid-10',
    telefono: '5215512345678',
    nombre: 'Juan Pérez',
    serieFolio: 'A0-260605320',
    puntosRevertidos: '-150.00', // ya viene con signo desde el ledger (ver LoyaltyPointsLedger#puntos)
    fecha: '2026-11-03T12:00:00.000Z',
    collectionRequestId: 'cr-42',
    bankMovementId: 'mov-99',
    ...overrides,
  };
}

describe('VentasCanceladasAuditoriaLealtadComponent', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let router: jasmine.SpyObj<Router>;
  let comp: VentasCanceladasAuditoriaLealtadComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listarVentasCanceladasConDeposito']);
    loyalty.listarVentasCanceladasConDeposito.and.returnValue(of([]));
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    comp = new VentasCanceladasAuditoriaLealtadComponent(loyalty, router);
  });

  describe('cargar() / ngOnInit()', () => {
    it('camino feliz: carga la lista y apaga loading', () => {
      const v = venta();
      loyalty.listarVentasCanceladasConDeposito.and.returnValue(of([v]));

      comp.ngOnInit();

      expect(comp.ventas).toEqual([v]);
      expect(comp.loading).toBe(false);
      expect(comp.error).toBe('');
    });

    it('error: expone un mensaje y apaga loading', () => {
      loyalty.listarVentasCanceladasConDeposito.and.returnValue(throwError(() => ({ error: { error: 'boom' } })));
      comp.ngOnInit();
      expect(comp.error).toBe('boom');
      expect(comp.loading).toBe(false);
    });

    it('error sin mensaje del backend: usa el mensaje genérico', () => {
      loyalty.listarVentasCanceladasConDeposito.and.returnValue(throwError(() => ({})));
      comp.ngOnInit();
      expect(comp.error).toBe('No se pudieron cargar las ventas canceladas con depósito.');
    });
  });

  describe('verTarjeta()', () => {
    it('navega a tarjeta-detail con el cardId de la fila', () => {
      const v = venta({ cardId: 'card-uuid-77' });
      comp.verTarjeta(v);
      expect(router.navigate).toHaveBeenCalledWith(['/lealtad/tarjetas', 'card-uuid-77']);
    });

    it('sin cardId (tarjeta no vino en la respuesta): no navega', () => {
      const v = venta({ cardId: null });
      comp.verTarjeta(v);
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });
});

/**
 * Template real (TestBed) — mismo criterio que VentasFallidasLealtadComponent: confirma que la
 * tabla realmente refleja los datos en el DOM. NO_ERRORS_SCHEMA ignora directivas/componentes no
 * relevantes para esta pantalla.
 */
describe('VentasCanceladasAuditoriaLealtadComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<VentasCanceladasAuditoriaLealtadComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listarVentasCanceladasConDeposito']);
    loyalty.listarVentasCanceladasConDeposito.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      declarations: [VentasCanceladasAuditoriaLealtadComponent],
      providers: [
        { provide: LoyaltyService, useValue: loyalty },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(VentasCanceladasAuditoriaLealtadComponent);
  });

  it('sin ventas: muestra el mensaje vacío', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin ventas canceladas con depósito relacionado registradas.');
  });

  it('renderiza nombre, teléfono, serieFolio, puntos revertidos y referencia de depósito', () => {
    loyalty.listarVentasCanceladasConDeposito.and.returnValue(of([venta({
      nombre: 'Ana Gómez', telefono: '5215599998888', serieFolio: 'A0-999', puntosRevertidos: '-200.00',
      collectionRequestId: 'cr-42', bankMovementId: 'mov-7',
    })]));
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Ana Gómez');
    expect(texto).toContain('5215599998888');
    expect(texto).toContain('A0-999');
    expect(texto).toContain('-200.00');
    expect(texto).toContain('Solicitud #cr-42');
    expect(texto).toContain('Movimiento #mov-7');
  });

  it('click en una fila navega a la tarjeta correspondiente', () => {
    const v = venta({ cardId: 'card-uuid-55' });
    loyalty.listarVentasCanceladasConDeposito.and.returnValue(of([v]));
    fixture.detectChanges();

    const router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    const fila: HTMLTableRowElement = fixture.nativeElement.querySelector('.vca-row');
    fila.click();

    expect(router.navigate).toHaveBeenCalledWith(['/lealtad/tarjetas', 'card-uuid-55']);
  });
});
