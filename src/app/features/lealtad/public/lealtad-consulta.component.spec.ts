import { TestBed, ComponentFixture } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { LealtadConsultaComponent } from './lealtad-consulta.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { LoyaltyConsultaPublicaResult } from '../../../core/models/loyalty.model';

/**
 * RED (PR7, Phase 7 task 7.4-7.5) — reemplaza el placeholder de PR5. spec
 * loyalty-public-lookup: POST (nunca GET, D8), error genérico único sin
 * importar la causa real del fallo, respuesta mínima (nombre, nivel,
 * saldoPuntos — SIN actividad reciente, confirmado 2026-10-15).
 */
const RESULT: LoyaltyConsultaPublicaResult = { nombre: 'Juan', nivel: 'Plata', saldoPuntos: 123.45 };

describe('LealtadConsultaComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<LealtadConsultaComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['consultaPublica']);

    // El saldo se anima con requestAnimationFrame (conteo ascendente) salvo con
    // prefers-reduced-motion — se fuerza acá para que el valor final esté
    // disponible de forma síncrona en los asserts de este spec.
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);

    await TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [LealtadConsultaComponent],
      providers: [{ provide: LoyaltyService, useValue: loyalty }],
    }).compileComponents();

    fixture = TestBed.createComponent(LealtadConsultaComponent);
  });

  function setInput(testId: string, value: string): void {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('renders the phone + NIP form with no sidebar/staff chrome', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('10 dígitos');
    expect(text).toContain('NIP');
    expect(fixture.nativeElement.querySelector('app-sidebar')).toBeNull();
  });

  it('a successful lookup shows nombre, nivel and saldoPuntos only (no recent activity)', () => {
    loyalty.consultaPublica.and.returnValue(of(RESULT));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    setInput('consulta-nip', '1234');
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="consulta-submit"]');
    btn.click();
    fixture.detectChanges();

    expect(loyalty.consultaPublica).toHaveBeenCalledWith('5512345678', '1234');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Juan');
    expect(text).toContain('Plata');
    expect(text).toContain('123.45');
    expect(text.toLowerCase()).not.toContain('movimiento');
  });

  it('a failed lookup (422, unknown phone/wrong NIP/locked) shows the same generic message', () => {
    loyalty.consultaPublica.and.returnValue(throwError(() => ({
      status: 422, error: { error: 'No se encontró ninguna tarjeta con ese teléfono y NIP.', code: 'LOYALTY_LOOKUP_FAILED' },
    })));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    setInput('consulta-nip', '0000');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-submit"]').click();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('No se encontró ninguna tarjeta con ese teléfono y NIP.');
    expect(fixture.componentInstance.error).toBeTruthy();
  });

  it('an invalid local format (not 10-digit phone / not 4-digit NIP) is rejected without calling the service', () => {
    fixture.detectChanges();
    setInput('consulta-telefono', '123');
    setInput('consulta-nip', '1234');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-submit"]').click();

    expect(loyalty.consultaPublica).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error).toBeTruthy();
  });
});

describe('LealtadConsultaComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let comp: LealtadConsultaComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['consultaPublica']);
    // Sin TestBed no hay zona que limpie un requestAnimationFrame real al
    // terminar el test — forzamos reduced-motion para que animarSaldo()
    // tome el camino síncrono y no deje un rAF corriendo de fondo.
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
    comp = new LealtadConsultaComponent(loyalty);
  });

  it('consultar(): calls the service with trimmed values on valid input', () => {
    loyalty.consultaPublica.and.returnValue(of(RESULT));
    comp.telefono = '  5512345678  ';
    comp.nip = ' 1234 ';
    comp.consultar();
    expect(loyalty.consultaPublica).toHaveBeenCalledWith('5512345678', '1234');
    expect(comp.result).toEqual(RESULT);
    expect(comp.loading).toBe(false);
  });

  it('consultar(): same generic error whether the failure is a wrong NIP, unknown phone, or a locked card (never field-specific)', () => {
    const PHONE = '5512345678';
    const cases = [
      { status: 422, error: { error: 'No se encontró ninguna tarjeta con ese teléfono y NIP.' } },
      { status: 422, error: { error: 'Tarjeta bloqueada temporalmente.' } },
      { status: 429, error: { error: 'Demasiadas consultas.' } },
    ];
    const mensajes = cases.map((err) => {
      loyalty.consultaPublica.and.returnValue(throwError(() => err));
      comp.telefono = PHONE;
      comp.nip = '1234';
      comp.consultar();
      return comp.error;
    });
    expect(new Set(mensajes).size).toBe(1); // un único mensaje, sin importar la causa real
    expect(mensajes[0]).not.toContain('teléfono');
    expect(mensajes[0]).not.toContain('bloqueada');
  });

  it('consultar(): rejects a phone that is not exactly 10 digits without calling the service', () => {
    comp.telefono = '123456789';
    comp.nip = '1234';
    comp.consultar();
    expect(loyalty.consultaPublica).not.toHaveBeenCalled();
    expect(comp.error).toBeTruthy();
  });

  it('consultar(): rejects a NIP that is not exactly 4 digits without calling the service', () => {
    comp.telefono = '5512345678';
    comp.nip = '123';
    comp.consultar();
    expect(loyalty.consultaPublica).not.toHaveBeenCalled();
  });

  it('nuevaConsulta(): resets the form and clears the result/error', () => {
    comp.telefono = '5512345678';
    comp.nip = '1234';
    comp.result = RESULT;
    comp.error = 'algo';
    comp.nuevaConsulta();
    expect(comp.telefono).toBe('');
    expect(comp.nip).toBe('');
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
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['consultaPublica']);
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
    loyalty.consultaPublica.and.returnValue(of({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 200 }));
    comp.telefono = '5512345678';
    comp.nip = '1234';
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
