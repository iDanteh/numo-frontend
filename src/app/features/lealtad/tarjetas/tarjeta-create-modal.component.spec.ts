import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { TarjetaCreateModalComponent } from './tarjeta-create-modal.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { LoyaltyCrearTarjetaResult } from '../../../core/models/loyalty.model';

/**
 * RED (PR6, task 6.4-6.5) — modal "+ Nueva tarjeta": teléfono de 10 dígitos
 * validado, NIP generado del lado del servidor (nunca tecleado por staff,
 * D6), error de teléfono duplicado del backend (409, spec "Duplicate phone
 * rejected") mostrado inline.
 */
describe('TarjetaCreateModalComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<TarjetaCreateModalComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['crearTarjeta']);
    await TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [TarjetaCreateModalComponent],
      providers: [{ provide: LoyaltyService, useValue: loyalty }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(TarjetaCreateModalComponent);
  });

  it('shows a validation error and does not call the service when the phone is not 10 digits', () => {
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.telefono = '12345';
    comp.nombre = 'Juan';
    comp.guardar();
    fixture.detectChanges();
    expect(loyalty.crearTarjeta).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('10 dígitos');
  });

  it('shows the backend 409 duplicate-phone message inline on submit', () => {
    loyalty.crearTarjeta.and.returnValue(throwError(() => ({ error: { error: 'El teléfono ya está registrado.' } })));
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.telefono = '5512345678';
    comp.nombre = 'Juan';
    comp.guardar();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('El teléfono ya está registrado.');
  });
});

describe('TarjetaCreateModalComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let comp: TarjetaCreateModalComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['crearTarjeta']);
    comp = new TarjetaCreateModalComponent(loyalty);
  });

  it('guardar(): rejects a phone that is not exactly 10 digits, without calling the service', () => {
    comp.telefono = '551234';
    comp.nombre = 'Juan';
    comp.guardar();
    expect(loyalty.crearTarjeta).not.toHaveBeenCalled();
    expect(comp.error).toContain('10 dígitos');
  });

  it('guardar(): rejects a missing nombre', () => {
    comp.telefono = '5512345678';
    comp.nombre = '  ';
    comp.guardar();
    expect(loyalty.crearTarjeta).not.toHaveBeenCalled();
    expect(comp.error).toBeTruthy();
  });

  it('guardar(): on success, emits created with {card, nip} exactly once', () => {
    const fixture: LoyaltyCrearTarjetaResult = {
      card: { id: '1', telefono: '5512345678', nombre: 'Juan', nivel: 'Bronce', saldoPuntos: 0, activa: true },
      nip: '7777',
    };
    loyalty.crearTarjeta.and.returnValue(of(fixture));
    let emitted: LoyaltyCrearTarjetaResult | undefined;
    comp.created.subscribe(r => emitted = r);
    comp.telefono = '5512345678';
    comp.nombre = 'Juan';
    comp.guardar();
    expect(loyalty.crearTarjeta).toHaveBeenCalledWith({ telefono: '5512345678', nombre: 'Juan', nivel: 'Bronce' });
    expect(emitted).toEqual(fixture);
    expect(comp.saving).toBe(false);
  });

  it('guardar(): incluye "datos adicionales" en el payload cuando se completan', () => {
    loyalty.crearTarjeta.and.returnValue(of({ card: { id: '1', telefono: '5512345678', nombre: 'Juan', nivel: 'Bronce', saldoPuntos: 0, activa: true }, nip: '7777' }));
    comp.telefono = '5512345678';
    comp.nombre = 'Juan';
    comp.datos = { apellidos: 'Pérez', sucursal: 'Matriz' };
    comp.guardar();
    expect(loyalty.crearTarjeta).toHaveBeenCalledWith({
      telefono: '5512345678', nombre: 'Juan', nivel: 'Bronce', apellidos: 'Pérez', sucursal: 'Matriz',
    });
  });

  it('guardar(): surfaces the backend error message and stops saving on failure', () => {
    loyalty.crearTarjeta.and.returnValue(throwError(() => ({ error: { error: 'El teléfono ya está registrado.' } })));
    comp.telefono = '5512345678';
    comp.nombre = 'Juan';
    comp.guardar();
    expect(comp.error).toBe('El teléfono ya está registrado.');
    expect(comp.saving).toBe(false);
  });
});
