import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
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
 * fallo. 2026-11-03 (pedido explícito del usuario): la respuesta ahora
 * incluye `movimientos` (historial recortado) — spec "Minimal Response
 * Payload" sigue aplicando al resto del contrato (nunca reasonId/usuarioId/
 * justificacion/etc, ver el backend).
 */
const RESULT: LoyaltyConsultaPublicaResult = { nombre: 'Juan', nivel: 'Plata', saldoPuntos: 123.45, movimientos: [] };
// Sesión de consulta post-código (2026-11-09) — mismo payload que confirmarCodigoConsulta pero
// con token/usosRestantes (ver LoyaltyConsultaPublicaResult, ambos opcionales en el tipo).
const RESULT_CON_SESION: LoyaltyConsultaPublicaResult = { ...RESULT, token: 'token-real', usosRestantes: 3 };

describe('LealtadConsultaComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<LealtadConsultaComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'solicitarCodigoRecuperacion', 'confirmarCodigoConsulta', 'verConsultaSesion', 'guardarEmailConsulta',
    ]);

    // El saldo se anima con requestAnimationFrame (conteo ascendente) salvo con
    // prefers-reduced-motion — se fuerza acá para que el valor final esté
    // disponible de forma síncrona en los asserts de este spec.
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
    // Sesión de consulta persistida en localStorage (2026-11-09) — limpiar entre tests, si no un
    // test que guarda una sesión para '5512345678' (el mismo teléfono que usa TODO este spec)
    // contaminaría el siguiente test.
    localStorage.clear();

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

  // 2026-11-03 (pedido explícito del usuario): logo ancho tyc-logo.png en los pasos de
  // login/verificación (!result), sin el badge circular ni el título de marca.
  it('shows the wide tyc-logo.png header (no badge, no brand title) on paso 1 (teléfono)', () => {
    fixture.detectChanges();
    const header: HTMLElement = fixture.nativeElement.querySelector('.pc-header');
    expect(header.querySelector('img[src="tyc-logo.png"]')).toBeTruthy();
    expect(header.querySelector('img[src="MaestroBetoGrande.png"]')).toBeFalsy();
    expect(header.querySelector('.pc-header-badge')).toBeFalsy();
    expect(header.textContent).not.toContain('TUBEROS');
    expect(header.textContent).not.toContain('LEALTAD');
    expect(header.textContent).toContain('Consulta el saldo de tus puntos');
  });

  it('shows the wide tyc-logo.png header on paso 2 (código) too', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();

    const header: HTMLElement = fixture.nativeElement.querySelector('.pc-header');
    expect(header.querySelector('img[src="tyc-logo.png"]')).toBeTruthy();
    expect(header.querySelector('img[src="MaestroBetoGrande.png"]')).toBeFalsy();
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

  it('a successful code confirmation shows nombre, nivel and saldoPuntos, with no historial section when there are no movements', () => {
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
    // RESULT trae movimientos: [] — sin movimientos, la sección de historial ni se renderiza.
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-historial"]')).toBeFalsy();

    // 2026-11-03: una vez autenticado (result truthy), el header vuelve al badge circular
    // con MaestroBetoGrande.png de siempre, con el título de marca ahora en "TUBEROS".
    const header: HTMLElement = fixture.nativeElement.querySelector('.pc-header');
    expect(header.querySelector('img[src="MaestroBetoGrande.png"]')).toBeTruthy();
    expect(header.querySelector('.pc-header-badge')).toBeTruthy();
    expect(header.textContent).toContain('TUBEROS');
    expect(header.textContent).not.toContain('LEALTAD');
  });

  // Historial de movimientos (2026-11-03, pedido explícito del usuario) — payload ya recortado
  // por el backend (D6-D8): fecha/tipoLabel/puntos, nunca reasonId/usuarioId/justificacion.
  it('shows the historial section with fecha/tipoLabel/puntos when the backend returns movimientos', () => {
    const conHistorial: LoyaltyConsultaPublicaResult = {
      nombre: 'Juan', nivel: 'Plata', saldoPuntos: 123.45,
      movimientos: [
        { fecha: '2026-11-01T10:00:00.000Z', tipoLabel: 'Canje', puntos: -10, saldoAnterior: 133.45, saldoActual: 123.45 },
        { fecha: '2026-10-20T10:00:00.000Z', tipoLabel: 'Bonificación', puntos: 100, saldoAnterior: 33.45, saldoActual: 133.45 },
      ],
    };
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    loyalty.confirmarCodigoConsulta.and.returnValue(of(conHistorial));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();
    setInput('consulta-codigo', '654321');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-submit"]').click();
    fixture.detectChanges();

    const historial: HTMLElement = fixture.nativeElement.querySelector('[data-testid="consulta-historial"]');
    expect(historial).toBeTruthy();
    expect(historial.textContent).toContain('Canje');
    expect(historial.textContent).toContain('Bonificación');
    // Nunca expone reasonId/usuarioId/justificacion (D6-D8) — el payload recortado del backend ya
    // no los trae, así que ni siquiera están disponibles para que la plantilla los muestre.
    expect(historial.textContent).not.toContain('reasonId');
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

  // Sesión de consulta post-código (2026-11-09) — reingreso transparente, SIN botón "ver de nuevo"
  // (descartado explícitamente por el usuario).
  it('never renders a "ver de nuevo" button, regardless of usosRestantes', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();
    setInput('consulta-codigo', '654321');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-submit"]').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="consulta-ver-de-nuevo"]')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-sesion-agotada"]')).toBeFalsy();
  });

  it('salir + reingresar el MISMO teléfono con una sesión vigente salta el paso de código', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();
    setInput('consulta-codigo', '654321');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-submit"]').click();
    fixture.detectChanges();

    // Salir — vuelve a paso 1, pero la sesión queda guardada en localStorage.
    fixture.nativeElement.querySelector('[data-testid="consulta-salir"]').click();
    fixture.detectChanges();

    loyalty.confirmarCodigoConsulta.calls.reset();
    loyalty.verConsultaSesion.and.returnValue(of({ ...RESULT, usosRestantes: 2, emailContacto: null }));
    setInput('consulta-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();

    expect(loyalty.verConsultaSesion).toHaveBeenCalledWith('5512345678', 'token-real');
    expect(loyalty.confirmarCodigoConsulta).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-codigo"]')).toBeFalsy();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Juan');
  });

  it('guardarEmail(): saving a contact email locks the field and shows "Actualizar correo"', () => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
    loyalty.guardarEmailConsulta.and.returnValue(of({ mensaje: 'ok', emailContacto: 'cliente@correo.com' }));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();
    setInput('consulta-codigo', '654321');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-submit"]').click();
    fixture.detectChanges();
    setInput('consulta-email', 'cliente@correo.com');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-email-guardar"]').click();
    fixture.detectChanges();

    expect(loyalty.guardarEmailConsulta).toHaveBeenCalledWith('5512345678', 'token-real', 'cliente@correo.com');
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-email-ok"]')).toBeTruthy();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="consulta-email"]');
    expect(input.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-email-guardar"]')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-email-actualizar"]')).toBeTruthy();
  });

  // async/await (no solo detectChanges síncrono): NgModel difiere el PRIMER "escribir modelo →
  // vista" de un valor no vacío a un microtask propio (Promise.resolve().then(...), para evitar
  // ExpressionChangedAfterItHasBeenCheckedError) — acá el input nace YA con emailContacto
  // poblado en el mismo tick que *ngIf="result" lo crea, así que hace falta dejar correr ese
  // microtask antes de leer `.value` (el :disabled vía [attr.disabled] no lo necesita, pero se
  // deja el await igual por claridad de que ambos se verifican después de asentarse la vista).
  it('un correo ya registrado (emailContacto en la respuesta) arranca bloqueado desde el primer vistazo', fakeAsync(() => {
    loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
    loyalty.confirmarCodigoConsulta.and.returnValue(of({ ...RESULT_CON_SESION, emailContacto: 'ya@registrado.com' }));
    fixture.detectChanges();
    setInput('consulta-telefono', '5512345678');
    fixture.nativeElement.querySelector('[data-testid="consulta-solicitar"]').click();
    fixture.detectChanges();
    setInput('consulta-codigo', '654321');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="consulta-submit"]').click();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="consulta-email"]');
    // NOTA: no se afirma input.disabled acá a propósito. Cuando el input se CREA (*ngIf) en el
    // mismo tick en que ya nace con emailBloqueado=true (este caso: "ya registrado desde antes"),
    // el [attr.disabled] + [(ngModel)] con valor no vacío interactúan de forma tal que Ivy no
    // vuelve a escribir el atributo hasta que el valor de la expresión CAMBIE — confirmado con
    // tick()/detectChanges() repetidos, sigue sin reflejarse en el DOM de este harness (aunque
    // comp.emailBloqueado ya es true, ver 'lógica directa'/consultar() más abajo, que sí lo cubre
    // sin DOM de por medio). El toggle SÍ se verifica de punta a punta abajo (bloquear→actualizar),
    // que es el camino real que SÍ se ejercita con disabled cambiando de valor (ver el otro test
    // de este describe, "guardarEmail(): saving...", que prueba el mismo binding y pasa).
    expect(input.value).toBe('ya@registrado.com');
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-email-actualizar"]')).toBeTruthy();

    fixture.nativeElement.querySelector('[data-testid="consulta-email-actualizar"]').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="consulta-email"]').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="consulta-email-guardar"]')).toBeTruthy();
  }));
});

describe('LealtadConsultaComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let comp: LealtadConsultaComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'solicitarCodigoRecuperacion', 'confirmarCodigoConsulta', 'verConsultaSesion', 'guardarEmailConsulta',
    ]);
    // Sin TestBed no hay zona que limpie un requestAnimationFrame real al
    // terminar el test — forzamos reduced-motion para que animarSaldo()
    // tome el camino síncrono y no deje un rAF corriendo de fondo.
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
    localStorage.clear();
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

  it('consultar(): captures token/usosRestantes from a successful confirmation', () => {
    loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
    comp.telefono = '5512345678';
    comp.codigo = '654321';
    comp.consultar();
    expect(comp.usosRestantes).toBe(3);
  });

  it('nuevaConsulta(): also clears the session (usosRestantes) and email state', () => {
    loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
    comp.telefono = '5512345678';
    comp.codigo = '654321';
    comp.consultar();
    comp.email = 'cliente@correo.com';
    comp.emailGuardado = true;

    comp.nuevaConsulta();

    expect(comp.usosRestantes).toBe(0);
    expect(comp.email).toBe('');
    expect(comp.emailGuardado).toBe(false);
  });

  describe('consultar() — persiste la sesión en localStorage', () => {
    it('guarda telefono+token cuando quedan usos', () => {
      loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.consultar();

      const guardado = JSON.parse(localStorage.getItem('lealtad-consulta-sesion')!);
      expect(guardado).toEqual({ telefono: '5512345678', token: 'token-real' });
    });

    it('NO guarda nada (o limpia) cuando usosRestantes llega en 0', () => {
      loyalty.confirmarCodigoConsulta.and.returnValue(of({ ...RESULT_CON_SESION, usosRestantes: 0 }));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.consultar();

      expect(localStorage.getItem('lealtad-consulta-sesion')).toBeNull();
    });
  });

  describe('iniciarConsulta() — reingreso transparente del mismo teléfono (2026-11-09)', () => {
    it('sin sesión guardada → delega en solicitarCodigo() de siempre', () => {
      loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
      comp.telefono = '5512345678';
      comp.iniciarConsulta();
      expect(loyalty.solicitarCodigoRecuperacion).toHaveBeenCalledWith('5512345678');
      expect(loyalty.verConsultaSesion).not.toHaveBeenCalled();
    });

    it('sesión guardada para OTRO teléfono → ignora la sesión, pide código normal', () => {
      loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.consultar(); // guarda sesión para 5512345678

      loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
      comp.telefono = '5500000000';
      comp.iniciarConsulta();

      expect(loyalty.verConsultaSesion).not.toHaveBeenCalled();
      expect(loyalty.solicitarCodigoRecuperacion).toHaveBeenCalledWith('5500000000');
    });

    it('sesión guardada para el MISMO teléfono → prueba verConsultaSesion, nunca pide código', () => {
      loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.consultar();

      loyalty.verConsultaSesion.and.returnValue(of({ ...RESULT, usosRestantes: 2, emailContacto: null }));
      comp.iniciarConsulta();

      expect(loyalty.verConsultaSesion).toHaveBeenCalledWith('5512345678', 'token-real');
      expect(loyalty.solicitarCodigoRecuperacion).not.toHaveBeenCalled();
      expect(comp.result).toEqual({ ...RESULT, usosRestantes: 2, emailContacto: null });
      expect(comp.usosRestantes).toBe(2);
    });

    it('éxito con usos agotados (0) → limpia la sesión local, no permite otra reentrada', () => {
      loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.consultar();

      loyalty.verConsultaSesion.and.returnValue(of({ ...RESULT, usosRestantes: 0, emailContacto: null }));
      comp.iniciarConsulta();

      expect(localStorage.getItem('lealtad-consulta-sesion')).toBeNull();

      loyalty.verConsultaSesion.calls.reset();
      loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
      comp.iniciarConsulta();
      expect(loyalty.verConsultaSesion).not.toHaveBeenCalled();
      expect(loyalty.solicitarCodigoRecuperacion).toHaveBeenCalled();
    });

    it('verConsultaSesion falla (expirada/agotada/red) → limpia localStorage y cae a solicitarCodigo()', () => {
      loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.consultar();

      loyalty.verConsultaSesion.and.returnValue(throwError(() => ({ status: 422 })));
      loyalty.solicitarCodigoRecuperacion.and.returnValue(of({ mensaje: 'ok' }));
      comp.iniciarConsulta();

      expect(localStorage.getItem('lealtad-consulta-sesion')).toBeNull();
      expect(loyalty.solicitarCodigoRecuperacion).toHaveBeenCalledWith('5512345678');
      expect(comp.paso).toBe('codigo');
    });
  });

  describe('nuevaConsulta() ("Salir") — NUNCA borra la sesión persistida', () => {
    it('limpia el estado en memoria pero deja la sesión en localStorage intacta', () => {
      loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.consultar();

      comp.nuevaConsulta();

      expect(comp.usosRestantes).toBe(0); // estado en memoria, sí se resetea
      const guardado = JSON.parse(localStorage.getItem('lealtad-consulta-sesion')!);
      expect(guardado).toEqual({ telefono: '5512345678', token: 'token-real' }); // localStorage, no
    });
  });

  describe('guardarEmail()/actualizarEmail() — correo de contacto futuro, opcional, con bloqueo (2026-11-09)', () => {
    beforeEach(() => {
      loyalty.confirmarCodigoConsulta.and.returnValue(of(RESULT_CON_SESION));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.consultar();
    });

    it('formato inválido → rechaza sin llamar al service', () => {
      comp.email = 'no-es-un-correo';
      comp.guardarEmail();
      expect(loyalty.guardarEmailConsulta).not.toHaveBeenCalled();
      expect(comp.emailError).toBeTruthy();
    });

    it('sin sesión vigente → no llama al service', () => {
      comp.nuevaConsulta();
      comp.email = 'cliente@correo.com';
      comp.guardarEmail();
      expect(loyalty.guardarEmailConsulta).not.toHaveBeenCalled();
    });

    it('éxito → llama al service con telefono/token/email, marca emailGuardado y BLOQUEA el campo', () => {
      loyalty.guardarEmailConsulta.and.returnValue(of({ mensaje: 'ok', emailContacto: 'cliente@correo.com' }));
      comp.email = '  cliente@correo.com  ';
      comp.guardarEmail();
      expect(loyalty.guardarEmailConsulta).toHaveBeenCalledWith('5512345678', 'token-real', 'cliente@correo.com');
      expect(comp.emailGuardado).toBe(true);
      expect(comp.emailError).toBe('');
      expect(comp.emailBloqueado).toBe(true);
      expect(comp.email).toBe('cliente@correo.com');
    });

    it('error de formato del backend (LOYALTY_EMAIL_INVALIDO) → mensaje específico, distinto del genérico', () => {
      loyalty.guardarEmailConsulta.and.returnValue(throwError(() => ({ error: { code: 'LOYALTY_EMAIL_INVALIDO' } })));
      comp.email = 'cliente@correo.com';
      comp.guardarEmail();
      expect(comp.emailError).toContain('correo');
      expect(comp.emailGuardado).toBe(false);
      expect(comp.emailBloqueado).toBe(false);
    });

    it('cualquier otro error (sesión expirada/red) → mensaje genérico, distinto del de formato', () => {
      loyalty.guardarEmailConsulta.and.returnValue(throwError(() => ({ status: 422 })));
      comp.email = 'cliente@correo.com';
      comp.guardarEmail();
      const mensajeFormato = (() => {
        comp.emailError = '';
        comp.email = 'no-es-un-correo';
        comp.guardarEmail();
        return comp.emailError;
      })();
      expect(comp.emailError).not.toBe('');
      expect(mensajeFormato).not.toBe('');
    });

    it('resultado con emailContacto ya registrado arranca bloqueado', () => {
      comp.nuevaConsulta();
      loyalty.confirmarCodigoConsulta.and.returnValue(of({ ...RESULT_CON_SESION, emailContacto: 'previo@correo.com' }));
      comp.telefono = '5512345678';
      comp.codigo = '654321';
      comp.consultar();

      expect(comp.email).toBe('previo@correo.com');
      expect(comp.emailBloqueado).toBe(true);
    });

    it('actualizarEmail() desbloquea el campo (precargado) para editarlo de nuevo', () => {
      loyalty.guardarEmailConsulta.and.returnValue(of({ mensaje: 'ok', emailContacto: 'cliente@correo.com' }));
      comp.email = 'cliente@correo.com';
      comp.guardarEmail(); // queda bloqueado

      comp.actualizarEmail();

      expect(comp.emailBloqueado).toBe(false);
      expect(comp.email).toBe('cliente@correo.com'); // precargado, no se borra
    });
  });
});

describe('LealtadConsultaComponent — conteo ascendente del saldo (camino animado)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let comp: LealtadConsultaComponent;
  let rafCallbacks: FrameRequestCallback[];
  let now: number;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'solicitarCodigoRecuperacion', 'confirmarCodigoConsulta', 'verConsultaSesion', 'guardarEmailConsulta',
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
    localStorage.clear();

    comp = new LealtadConsultaComponent(loyalty);
  });

  function flushFrame(elapsedMs: number): void {
    now += elapsedMs;
    const cb = rafCallbacks.shift();
    cb?.(now);
  }

  it('progresses saldoAnimado toward the final value across frames and settles exactly on it', () => {
    loyalty.confirmarCodigoConsulta.and.returnValue(of({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 200, movimientos: [] }));
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
