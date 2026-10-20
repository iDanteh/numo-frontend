import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { RecuperarNipComponent } from './recuperar-nip.component';
import { LoyaltyService } from '../../../../core/services/loyalty.service';

/**
 * Recuperación de NIP en 2 pasos — mismo criterio "Generic Error, No Field
 * Disclosure" que LealtadConsultaComponent: un solo mensaje para código
 * incorrecto/expirado/tarjeta bloqueada, nunca distinguir la causa real.
 */
describe('RecuperarNipComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<RecuperarNipComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'solicitarCodigoRecuperacion', 'confirmarCodigoRecuperacion',
    ]);

    await TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [RecuperarNipComponent],
      providers: [{ provide: LoyaltyService, useValue: loyalty }],
      // Mismo criterio que lealtad-consulta.component.spec.ts: routerLink sin
      // montar RouterTestingModule (sin uso en todo el proyecto hoy).
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(RecuperarNipComponent);
  });

  function setInput(testId: string, value: string): void {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('starts on paso 1 (teléfono) with no sidebar/staff chrome', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="recuperar-telefono"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="recuperar-codigo"]')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('app-sidebar')).toBeNull();
  });

  it('an invalid phone format is rejected without calling the service', () => {
    fixture.detectChanges();
    setInput('recuperar-telefono', '123');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="recuperar-solicitar"]').click();

    expect(loyalty.solicitarCodigoRecuperacion).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error).toBeTruthy();
  });

  it('requesting a code moves to paso 2 and shows the generic mensaje from the backend', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'Si el teléfono está registrado…' }));
    fixture.detectChanges();
    setInput('recuperar-telefono', '5512345678');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="recuperar-solicitar"]').click();
    fixture.detectChanges();

    expect(loyalty.solicitarCodigoRecuperacion).toHaveBeenCalledWith('5512345678');
    expect(fixture.nativeElement.querySelector('[data-testid="recuperar-codigo"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="recuperar-codigo-dev"]')).toBeFalsy();
  });

  it('shows the SIMULACIÓN banner with codigoDev when the backend includes it (non-production)', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok', codigoDev: '654321' }));
    fixture.detectChanges();
    setInput('recuperar-telefono', '5512345678');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="recuperar-solicitar"]').click();
    fixture.detectChanges();

    const banner: HTMLElement = fixture.nativeElement.querySelector('[data-testid="recuperar-codigo-dev"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('654321');
    expect(banner.textContent).toContain('SIMULACIÓN');
  });

  it('a correct code shows the new NIP exactly once (paso éxito)', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    loyalty.confirmarCodigoRecuperacion.and.returnValue(of({ nip: '4821' }));
    fixture.detectChanges();
    setInput('recuperar-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="recuperar-solicitar"]').click();
    fixture.detectChanges();
    setInput('recuperar-codigo', '654321');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="recuperar-confirmar"]').click();
    fixture.detectChanges();

    expect(loyalty.confirmarCodigoRecuperacion).toHaveBeenCalledWith('5512345678', '654321');
    const nip: HTMLElement = fixture.nativeElement.querySelector('[data-testid="recuperar-nip-nuevo"]');
    expect(nip.textContent).toContain('4821');
  });

  it('a failed confirmation (wrong/expired code, locked card, network) shows the same generic message', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    loyalty.confirmarCodigoRecuperacion.and.returnValue(throwError(() => ({
      status: 422, error: { error: 'El código no es válido o expiró.', code: 'LOYALTY_RECOVERY_FAILED' },
    })));
    fixture.detectChanges();
    setInput('recuperar-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="recuperar-solicitar"]').click();
    fixture.detectChanges();
    setInput('recuperar-codigo', '000000');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="recuperar-confirmar"]').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.error).toBeTruthy();
    expect(fixture.componentInstance.paso).toBe('codigo');
  });

  it('an invalid code format (not 6 digits) is rejected without calling the service', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    fixture.detectChanges();
    setInput('recuperar-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="recuperar-solicitar"]').click();
    fixture.detectChanges();
    setInput('recuperar-codigo', '123');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="recuperar-confirmar"]').click();

    expect(loyalty.confirmarCodigoRecuperacion).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error).toBeTruthy();
  });
});

describe('RecuperarNipComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let comp: RecuperarNipComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'solicitarCodigoRecuperacion', 'confirmarCodigoRecuperacion',
    ]);
    comp = new RecuperarNipComponent(loyalty);
  });

  it('solicitarCodigo(): trims the phone before calling the service', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    comp.telefono = '  5512345678  ';
    comp.solicitarCodigo();
    expect(loyalty.solicitarCodigoRecuperacion).toHaveBeenCalledWith('5512345678');
    expect(comp.paso).toBe('codigo');
  });

  it('reintentarSolicitud(): vuelve a paso 1 y limpia código/mensaje/codigoDev', () => {
    comp.paso = 'codigo';
    comp.codigo = '654321';
    comp.mensajeSolicitud = 'algo';
    comp.codigoDev = '654321';
    comp.reintentarSolicitud();
    expect(comp.paso).toBe('telefono');
    expect(comp.codigo).toBe('');
    expect(comp.mensajeSolicitud).toBe('');
    expect(comp.codigoDev).toBeNull();
  });

  it('confirmarCodigo(): same generic error whether the failure is a wrong code, expired, or locked card', () => {
    const cases = [
      { status: 422, error: { error: 'El código no es válido o expiró.' } },
      { status: 422, error: { error: 'Tarjeta bloqueada temporalmente.' } },
      { status: 429, error: { error: 'Demasiados intentos.' } },
    ];
    const mensajes = cases.map((err) => {
      loyalty.confirmarCodigoRecuperacion.and.returnValue(throwError(() => err));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.confirmarCodigo();
      return comp.error;
    });
    expect(new Set(mensajes).size).toBe(1);
    expect(mensajes[0]).not.toContain('bloqueada');
  });
});
