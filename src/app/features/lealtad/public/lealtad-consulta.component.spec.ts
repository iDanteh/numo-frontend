import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { LealtadConsultaComponent } from './lealtad-consulta.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { LoyaltyConsultaPublicaResult } from '../../../core/models/loyalty.model';

/**
 * 2026-10-26 — reemplaza el NIP estático de 4 dígitos por un código de
 * verificación (OTP) en 2 pasos. spec loyalty-public-lookup se mantiene:
 * POST (nunca GET, D8), error genérico único sin importar la causa real del
 * fallo, respuesta mínima (nombre, nivel, saldoPuntos — sin actividad
 * reciente).
 */
const RESULT: LoyaltyConsultaPublicaResult = { nombre: 'Juan', nivel: 'Plata', saldoPuntos: 123.45 };

describe('LealtadConsultaComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<LealtadConsultaComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'solicitarCodigoRecuperacion', 'confirmarCodigoConsulta',
    ]);

    // El saldo se anima con requestAnimationFrame (conteo ascendente) salvo con
    // prefers-reduced-motion — se fuerza acá para que el valor final esté
    // disponible de forma síncrona en los asserts de este spec.
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);

    await TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [LealtadConsultaComponent],
      providers: [{ provide: LoyaltyService, useValue: loyalty }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(LealtadConsultaComponent);
  });

  function setInput(testId: string, value: string): void {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('starts on paso 1 (teléfono) with no sidebar/staff chrome, no NIP field', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('10 dígitos');
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-codigo"]')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('app-sidebar')).toBeNull();
  });

  it('requesting a code moves to paso 2 and shows the generic mensaje from the backend', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'Si el teléfono está registrado…' }));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();

    expect(loyalty.solicitarCodigoRecuperacion).toHaveBeenCalledWith('5512345678');
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-codigo"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-codigo-dev"]')).toBeFalsy();
  });

  it('shows the SIMULACIÓN banner with codigoDev when the backend includes it (non-production)', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok', codigoDev: '654321' }));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();

    const banner: HTMLElement = fixture.nativeElement.querySelector('[data-testid="consulta-codigo-dev"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('654321');
    expect(banner.textContent).toContain('SIMULACIÓN');
  });

  it('a successful code confirmation shows nombre, nivel and saldoPuntos only (no recent activity)', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();
    setInput('consulta-codigo', '654321');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-submit"]').click();
    fixture.detectChanges();

    expect(loyalty.confirmarCodigoConsulta).toHaveBeenCalledWith('5512345678', '654321');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Juan');
    expect(text).toContain('Plata');
    expect(text).toContain('123.45');
    expect(text.toLowerCase()).not.toContain('movimiento');
  });

  it('a failed confirmation (wrong/expired code, locked/inactive card, network) shows the same generic message', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    loyalty.confirmarCodigoConsulta.and.returnValue(throwError(() => ({
      status: 422, error: { error: 'El código no es válido o expiró.', code: 'LOYALTY_RECOVERY_FAILED' },
    })));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();
    setInput('consulta-codigo', '000000');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-submit"]').click();
    fixture.detectChanges();

    // El mensaje mostrado es SIEMPRE el GENERIC_ERROR propio del componente,
    // nunca err?.error?.error — no se compara contra el texto de backend
    // mockeado porque la redacción coincide a propósito (ver GENERIC_ERROR).
    expect(fixture.componentInstance.error).toBeTruthy();
    expect(fixture.componentInstance.paso).toBe('codigo');
  });

  it('an invalid phone format is rejected without calling the service', () => {
    fixture.detectChanges();
    setInput('consulta-telefono', '123');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();

    expect(loyalty.solicitarCodigoRecuperacion).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error).toBeTruthy();
  });

  it('an invalid code format (not 6 digits) is rejected without calling the service', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();
    setInput('consulta-codigo', '123');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-submit"]').click();

    expect(loyalty.confirmarCodigoConsulta).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error).toBeTruthy();
  });
});

describe('LealtadConsultaComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let comp: LealtadConsultaComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'solicitarCodigoRecuperacion', 'confirmarCodigoConsulta',
    ]);
    // Sin TestBed no hay zona que limpie un requestAnimationFrame real al
    // terminar el test — forzamos reduced-motion para que animarSaldo()
    // tome el camino síncrono y no deje un rAF corriendo de fondo.
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
    comp = new LealtadConsultaComponent(loyalty);
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

  it('consultar(): calls the service with trimmed values on valid input', () => {
    loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT));
    comp.telefono = '  5512345678  ';
    comp.codigo = ' 654321 ';
    comp.consultar();
    expect(loyalty.confirmarCodigoConsulta).toHaveBeenCalledWith('5512345678', '654321');
    expect(comp.result).toEqual(RESULT);
    expect(comp.loading).toBe(false);
  });

  it('consultar(): same generic error whether the failure is a wrong code, unknown phone, or a locked card (never field-specific)', () => {
    const cases = [
      { status: 422, error: { error: 'El código no es válido o expiró.' } },
      { status: 422, error: { error: 'Tarjeta bloqueada temporalmente.' } },
      { status: 429, error: { error: 'Demasiadas consultas.' } },
    ];
    const mensajes = cases.map((err) => {
      loyalty.confirmarCodigoConsulta.and.returnValue(throwError(() => err));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.consultar();
      return comp.error;
    });
    expect(new Set(mensajes).size).toBe(1); // un único mensaje, sin importar la causa real
    expect(mensajes[0]).not.toContain('bloqueada');
  });

  it('consultar(): rejects a code that is not exactly 6 digits without calling the service', () => {
    comp.telefono = '5512345678';
    comp.codigo = '123';
    comp.consultar();
    expect(loyalty.confirmarCodigoConsulta).not.toHaveBeenCalled();
    expect(comp.error).toBeTruthy();
  });

  it('nuevaConsulta(): resets the form and clears the result/error/paso', () => {
    comp.paso = 'codigo';
    comp.telefono = '5512345678';
    comp.codigo = '654321';
    comp.result = RESULT;
    comp.error = 'algo';
    comp.nuevaConsulta();
    expect(comp.paso).toBe('telefono');
    expect(comp.telefono).toBe('');
    expect(comp.codigo).toBe('');
    expect(comp.result).toBeNull();
    expect(comp.error).toBe('');
  });
});

describe('LealtadConsultaComponent — conteo ascendente del saldo (camino animado)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let comp: LealtadConsultaComponent;
  let rafCallbacks: FrameRequestCallback[];
  let now: number;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'solicitarCodigoRecuperacion', 'confirmarCodigoConsulta',
    ]);
    spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);

    rafCallbacks = [];
    now = 0;
    spyOn(performance, 'now').and.callFake(() => now);
    spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    spyOn(window, 'cancelAnimationFrame').and.stub();

    comp = new LealtadConsultaComponent(loyalty);
  });

  function flushFrame(elapsedMs: number): void {
    now += elapsedMs;
    const cb = rafCallbacks.shift();
    cb?.(now);
  }

  it('progresses saldoAnimado toward the final value across frames and settles exactly on it', () => {
    loyalty.confirmarCodigoConsulta.and.returnValue(of({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 200 }));
    comp.telefono = '5512345678';
    comp.codigo = '654321';
    comp.consultar();

    // Primer frame agendado (requestAnimationFrame mockeado), todavía no corrió.
    expect(comp.saldoAnimado).toBe(0);
    expect(rafCallbacks.length).toBe(1);

    flushFrame(350); // mitad de los 700ms de duración
    expect(comp.saldoAnimado).toBeCloseTo(100, 0);
    expect(rafCallbacks.length).toBe(1); // progreso < 1 → reagenda el siguiente frame

    flushFrame(350); // completa los 700ms
    expect(comp.saldoAnimado).toBe(200);
    expect(rafCallbacks.length).toBe(0); // progreso >= 1 → no reagenda más
  });
});
