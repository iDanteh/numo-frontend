import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { LoyaltyService } from './loyalty.service';
import { ApiService } from './api.service';
import {
  LoyaltyCard, LoyaltyCardListResult, LoyaltyCrearTarjetaResult, LoyaltyMovimientoResult,
  LoyaltyKoreConcepto, LoyaltyKoreFormaPago, LoyaltyKoreNivel, LoyaltySyncKoreResult,
} from '../models/loyalty.model';

/**
 * RED (PR6, Phase 6 task 6.1) — LoyaltyService no existe todavía. Mismo
 * patrón que bank.service.ts: delega el armado de la URL/params a
 * ApiService, no reimplementa HttpClient directo.
 */
describe('LoyaltyService', () => {
  let service: LoyaltyService;
  let httpMock: HttpTestingController;
  let apiBase: string;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
    });
    service = TestBed.inject(LoyaltyService);
    httpMock = TestBed.inject(HttpTestingController);
    apiBase = TestBed.inject(ApiService).base;
  });

  afterEach(() => httpMock.verify());

  it('listar(): GET /loyalty/cards con search/nivel/activa/page serializados como query params', () => {
    const fixture: LoyaltyCardListResult = {
      cards: [{ id: '1', telefono: '5512345678', nombre: 'Juan', nivel: 'Bronce', saldoPuntos: 0, activa: true }],
      total: 1, page: 1, limit: 20, pages: 1,
    };
    service.listar({ search: '551234', nivel: 'Bronce', activa: true, page: 1, limit: 20 })
      .subscribe(res => expect(res).toEqual(fixture));

    const req = httpMock.expectOne(r =>
      r.url === `${apiBase}/loyalty/cards` &&
      r.params.get('search') === '551234' &&
      r.params.get('nivel') === 'Bronce' &&
      r.params.get('activa') === 'true' &&
      r.params.get('page') === '1' &&
      r.params.get('limit') === '20');
    expect(req.request.method).toBe('GET');
    req.flush(fixture);
  });

  it('listar(): manda sort/sortDir cuando vienen, los omite cuando no', () => {
    const fixture: LoyaltyCardListResult = {
      cards: [], total: 0, page: 1, limit: 20, pages: 0,
    };
    service.listar({ sort: 'saldo', sortDir: 'DESC' })
      .subscribe(res => expect(res).toEqual(fixture));

    const req = httpMock.expectOne(r =>
      r.url === `${apiBase}/loyalty/cards` &&
      r.params.get('sort') === 'saldo' &&
      r.params.get('sortDir') === 'DESC');
    expect(req.request.method).toBe('GET');
    req.flush(fixture);
  });

  it('listar(): sin sort/sortDir no agrega esos query params', () => {
    const fixture: LoyaltyCardListResult = {
      cards: [], total: 0, page: 1, limit: 20, pages: 0,
    };
    service.listar({})
      .subscribe(res => expect(res).toEqual(fixture));

    const req = httpMock.expectOne(r => r.url === `${apiBase}/loyalty/cards`);
    expect(req.request.params.has('sort')).toBe(false);
    expect(req.request.params.has('sortDir')).toBe(false);
    req.flush(fixture);
  });

  it('crearTarjeta(): POST /loyalty/cards devuelve {card, nip}', () => {
    const fixture: LoyaltyCrearTarjetaResult = {
      card: { id: '2', telefono: '5512345679', nombre: 'Ana', nivel: 'Bronce', saldoPuntos: 0, activa: true },
      nip: '4821',
    };
    service.crearTarjeta({ telefono: '5512345679', nombre: 'Ana' })
      .subscribe(res => expect(res).toEqual(fixture));

    const req = httpMock.expectOne(`${apiBase}/loyalty/cards`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefono: '5512345679', nombre: 'Ana' });
    req.flush(fixture);
  });

  it('obtener(): GET /loyalty/cards/:id', () => {
    const fixture: LoyaltyCard = { id: '3', telefono: '5500000000', nombre: 'Luis', nivel: 'Oro', saldoPuntos: 100, activa: true };
    service.obtener('3').subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3`);
    expect(req.request.method).toBe('GET');
    req.flush(fixture);
  });

  it('editarTarjeta(): PATCH /loyalty/cards/:id con solo los campos provistos', () => {
    service.editarTarjeta('3', { nombre: 'Luis Nuevo' }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ nombre: 'Luis Nuevo' });
    req.flush({});
  });

  it('cambiarNip(): POST /loyalty/cards/:id/nip devuelve {nip} en texto plano', () => {
    service.cambiarNip('3').subscribe(res => expect(res).toEqual({ nip: '9012' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/nip`);
    expect(req.request.method).toBe('POST');
    req.flush({ nip: '9012' });
  });

  it('cambiarNivel(): PUT /loyalty/cards/:id/nivel con nuevoNivel y motivo', () => {
    service.cambiarNivel('3', 'Plata', 'Cliente frecuente').subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/nivel`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ nivel: 'Plata', motivo: 'Cliente frecuente' });
    req.flush({});
  });

  it('listarMovimientos(): GET /loyalty/cards/:id/movimientos con paginación', () => {
    service.listarMovimientos('3', 2, 10).subscribe();
    const req = httpMock.expectOne(r =>
      r.url === `${apiBase}/loyalty/cards/3/movimientos` && r.params.get('page') === '2' && r.params.get('limit') === '10');
    expect(req.request.method).toBe('GET');
    req.flush({ movimientos: [], page: 2, pages: 1, total: 0, limit: 10 });
  });

  it('listarNiveles(): GET /loyalty/cards/:id/niveles', () => {
    service.listarNiveles('3').subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/niveles`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('obtenerHistorialCambios(): GET /loyalty/cards/:id/historial', () => {
    service.obtenerHistorialCambios('3').subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/historial`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('registrarAcumulacion(): POST /loyalty/cards/:id/acumulaciones', () => {
    const fixture: LoyaltyMovimientoResult = {
      movimiento: {
        id: 10, cardId: '3', tipo: 'ACUMULACION', puntos: 50, saldoResultante: 150,
        montoVenta: 1000, porcentajeAplicado: 5, nivelAplicado: 'Plata', centroCostoId: 7,
        reasonId: null, justificacion: null, origen: 'manual', referenciaExterna: null,
        usuarioId: 'u1', usuarioNombre: 'Staff', createdAt: '2026-10-15T00:00:00Z',
      },
      saldoPuntos: 150,
    };
    service.registrarAcumulacion('3', { serieFolio: 'A0-260605320' })
      .subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/acumulaciones`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ serieFolio: 'A0-260605320' });
    req.flush(fixture);
  });

  it('registrarCanje(): POST /loyalty/cards/:id/canjes', () => {
    service.registrarCanje('3', { puntos: 60, serieFolio: 'A0-260605320' }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/canjes`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ puntos: 60, serieFolio: 'A0-260605320' });
    req.flush({});
  });

  it('registrarAjuste(): POST /loyalty/cards/:id/ajustes', () => {
    service.registrarAjuste('3', { puntos: 20, reasonId: 1, justificacion: 'Bono por cumpleaños' }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/ajustes`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ puntos: 20, reasonId: 1, justificacion: 'Bono por cumpleaños' });
    req.flush({});
  });

  it('obtenerPorcentajes(): GET /loyalty/config', () => {
    service.obtenerPorcentajes().subscribe(res => expect(res).toEqual({ Bronce: 1, Plata: 5, Oro: 10 }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config`);
    expect(req.request.method).toBe('GET');
    req.flush({ Bronce: 1, Plata: 5, Oro: 10 });
  });

  it('listarReasons(): GET /loyalty/reasons', () => {
    service.listarReasons().subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/reasons`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listarSucursales(): GET /loyalty/sucursales', () => {
    service.listarSucursales().subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/sucursales`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listarSucursales(): cachea con shareReplay(1) — una segunda llamada en la misma sesión no dispara otro GET', () => {
    service.listarSucursales().subscribe();
    httpMock.expectOne(`${apiBase}/loyalty/sucursales`).flush([]);

    service.listarSucursales().subscribe();
    httpMock.expectNone(`${apiBase}/loyalty/sucursales`);
  });

  it('actualizarSucursal(): invalida el caché de listarSucursales() para no servir datos obsoletos', () => {
    service.listarSucursales().subscribe();
    httpMock.expectOne(`${apiBase}/loyalty/sucursales`).flush([]);

    service.actualizarSucursal(9, { participaLealtad: false }).subscribe();
    httpMock.expectOne(`${apiBase}/loyalty/sucursales/9`).flush({});

    service.listarSucursales().subscribe();
    httpMock.expectOne(`${apiBase}/loyalty/sucursales`).flush([]);
  });

  // ── RED (PR7, Phase 7 task 7.1-7.2/7.4-7.5) ─────────────────────────────

  it('guardarPorcentajes(): PUT /loyalty/config/porcentajes con solo los niveles provistos', () => {
    service.guardarPorcentajes({ Oro: 10 }).subscribe(res => expect(res).toEqual({ Bronce: 1, Plata: 5, Oro: 10 }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/porcentajes`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ Oro: 10 });
    req.flush({ Bronce: 1, Plata: 5, Oro: 10 });
  });

  it('crearReason(): POST /loyalty/reasons', () => {
    service.crearReason({ clave: 'descuento', nombre: 'Descuento', puntosFijos: -50, categoria: 'ajuste' }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/reasons`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ clave: 'descuento', nombre: 'Descuento', puntosFijos: -50, categoria: 'ajuste' });
    req.flush({});
  });

  it('editarReason(): PATCH /loyalty/reasons/:id con solo los campos provistos (ej. solo activo)', () => {
    service.editarReason(4, { activo: false }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/reasons/4`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ activo: false });
    req.flush({});
  });

  it('actualizarSucursal(): PATCH /loyalty/sucursales/:id con solo la bandera provista (independientes, D12)', () => {
    service.actualizarSucursal(9, { participaLealtad: false }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/sucursales/9`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ participaLealtad: false });
    req.flush({});
  });

  it('consultaPublica(): POST /loyalty/public/consulta con {telefono, nip}, respuesta mínima + movimientos (D8, sin actividad reciente como reasonId/usuarioId)', () => {
    service.consultaPublica('5512345678', '1234').subscribe(res =>
      expect(res).toEqual({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120, movimientos: [] }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/consulta`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefono: '5512345678', nip: '1234' });
    req.flush({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120, movimientos: [] });
  });

  it('solicitarCodigoRecuperacion(): POST /loyalty/public/recuperacion/solicitar con {telefono}', () => {
    service.solicitarCodigoRecuperacion('5512345678').subscribe(res =>
      expect(res).toEqual({ mensaje: 'Si el teléfono está registrado…', codigoDev: '654321' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/recuperacion/solicitar`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefono: '5512345678' });
    req.flush({ mensaje: 'Si el teléfono está registrado…', codigoDev: '654321' });
  });

  it('confirmarCodigoConsulta(): POST /loyalty/public/consulta/confirmar con {telefono, codigo}, respuesta mínima + movimientos', () => {
    service.confirmarCodigoConsulta('5512345678', '654321').subscribe(res =>
      expect(res).toEqual({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120, movimientos: [] }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/consulta/confirmar`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefono: '5512345678', codigo: '654321' });
    req.flush({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120, movimientos: [] });
  });

  // ── Sesión de consulta post-código (2026-11-09) ─────────────────────────

  it('verConsultaSesion(): POST /loyalty/public/consulta/ver con {telefono, token}', () => {
    service.verConsultaSesion('5512345678', 'token-real').subscribe(res =>
      expect(res).toEqual({
        nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120, movimientos: [], usosRestantes: 2,
        emailContacto: null, fechaNacimientoCliente: null, tieneFoto: false,
      }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/consulta/ver`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefono: '5512345678', token: 'token-real' });
    req.flush({
      nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120, movimientos: [], usosRestantes: 2,
      emailContacto: null, fechaNacimientoCliente: null, tieneFoto: false,
    });
  });

  it('guardarEmailConsulta(): POST /loyalty/public/consulta/email con {telefono, token, email}', () => {
    service.guardarEmailConsulta('5512345678', 'token-real', 'cliente@correo.com').subscribe(res =>
      expect(res).toEqual({ mensaje: 'Listo, guardamos tu correo.', emailContacto: 'cliente@correo.com' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/consulta/email`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefono: '5512345678', token: 'token-real', email: 'cliente@correo.com' });
    req.flush({ mensaje: 'Listo, guardamos tu correo.', emailContacto: 'cliente@correo.com' });
  });

  it('guardarFechaNacimientoConsulta(): POST /loyalty/public/consulta/fecha-nacimiento con {telefono, token, fechaNacimiento}', () => {
    service.guardarFechaNacimientoConsulta('5512345678', 'token-real', '2000-01-15').subscribe(res =>
      expect(res).toEqual({ mensaje: 'Listo, guardamos tu fecha de nacimiento.', fechaNacimientoCliente: '2000-01-15' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/consulta/fecha-nacimiento`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefono: '5512345678', token: 'token-real', fechaNacimiento: '2000-01-15' });
    req.flush({ mensaje: 'Listo, guardamos tu fecha de nacimiento.', fechaNacimientoCliente: '2000-01-15' });
  });

  // Multipart (2026-11-23) — mismo criterio que generarConcentrado/clasificarImportacion más
  // abajo: ApiService.post() no fuerza Content-Type JSON cuando el body es un FormData.
  it('guardarFotoConsulta(): POST /loyalty/public/consulta/foto con FormData {telefono, token, foto}', () => {
    const archivo = new File([new Uint8Array(10)], 'foto.jpg', { type: 'image/jpeg' });
    service.guardarFotoConsulta('5512345678', 'token-real', archivo).subscribe(res =>
      expect(res).toEqual({ mensaje: 'Listo, guardamos tu foto.' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/consulta/foto`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBe(true);
    const body = req.request.body as FormData;
    expect(body.get('telefono')).toBe('5512345678');
    expect(body.get('token')).toBe('token-real');
    expect(body.get('foto')).toBe(archivo);
    req.flush({ mensaje: 'Listo, guardamos tu foto.' });
  });

  // emailContacto (2026-11-09) — correo ya registrado en una sesión anterior, para que el
  // frontend muestre el campo bloqueado desde el primer vistazo.
  it('verConsultaSesion(): pasa emailContacto de la respuesta tal cual (incluido null)', () => {
    service.verConsultaSesion('5512345678', 'token-real').subscribe(res =>
      expect(res.emailContacto).toBe('previo@correo.com'));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/consulta/ver`);
    req.flush({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120, movimientos: [], usosRestantes: 2, emailContacto: 'previo@correo.com' });
  });

  // ── Límite mensual de consultas con código (2026-11-09) ─────────────────

  it('obtenerConsultaCodigoMaxMes(): GET /loyalty/config/consulta-codigo-max-mes', () => {
    service.obtenerConsultaCodigoMaxMes().subscribe(res => expect(res).toEqual({ max: 1 }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/consulta-codigo-max-mes`);
    expect(req.request.method).toBe('GET');
    req.flush({ max: 1 });
  });

  it('guardarConsultaCodigoMaxMes(): PUT /loyalty/config/consulta-codigo-max-mes con {max}', () => {
    service.guardarConsultaCodigoMaxMes(2).subscribe(res => expect(res).toEqual({ max: 2 }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/consulta-codigo-max-mes`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ max: 2 });
    req.flush({ max: 2 });
  });

  it('guardarConsultaCodigoMaxMes(null): manda {max: null} para deshabilitar', () => {
    service.guardarConsultaCodigoMaxMes(null).subscribe(res => expect(res).toEqual({ max: null }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/consulta-codigo-max-mes`);
    expect(req.request.body).toEqual({ max: null });
    req.flush({ max: null });
  });

  // Límite de consultas SIN código (2026-11-20, nuevo) — vistas extra dentro de la sesión corta
  // post-código, ver loyalty-config.service.js#obtenerSesionConsultaUsosMax. A diferencia de
  // CONSULTA_CODIGO_MAX_MES, `max` nunca es null.
  it('obtenerSesionConsultaUsosMax(): GET /loyalty/config/sesion-consulta-usos-max', () => {
    service.obtenerSesionConsultaUsosMax().subscribe(res => expect(res).toEqual({ max: 3 }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/sesion-consulta-usos-max`);
    expect(req.request.method).toBe('GET');
    req.flush({ max: 3 });
  });

  it('guardarSesionConsultaUsosMax(): PUT /loyalty/config/sesion-consulta-usos-max con {max}', () => {
    service.guardarSesionConsultaUsosMax(5).subscribe(res => expect(res).toEqual({ max: 5 }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/sesion-consulta-usos-max`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ max: 5 });
    req.flush({ max: 5 });
  });

  it('guardarSesionConsultaUsosMax(0): manda {max: 0} (deshabilita de verdad, no "sin límite")', () => {
    service.guardarSesionConsultaUsosMax(0).subscribe(res => expect(res).toEqual({ max: 0 }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/sesion-consulta-usos-max`);
    expect(req.request.body).toEqual({ max: 0 });
    req.flush({ max: 0 });
  });

  // Permitir saldo negativo en canje de puntos en venta (2026-11-20, PROVISIONAL, nuevo) — ver
  // loyalty-kore-venta.service.js#_procesarUnAbonoNuevo en el backend.
  it('obtenerPermitirSaldoNegativoCanje(): GET /loyalty/config/permitir-saldo-negativo-canje', () => {
    service.obtenerPermitirSaldoNegativoCanje().subscribe(res => expect(res).toEqual({ habilitado: false }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/permitir-saldo-negativo-canje`);
    expect(req.request.method).toBe('GET');
    req.flush({ habilitado: false });
  });

  it('guardarPermitirSaldoNegativoCanje(): PUT /loyalty/config/permitir-saldo-negativo-canje con {habilitado}', () => {
    service.guardarPermitirSaldoNegativoCanje(true).subscribe(res => expect(res).toEqual({ habilitado: true }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/permitir-saldo-negativo-canje`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ habilitado: true });
    req.flush({ habilitado: true });
  });

  // ── OTP envío (WhatsApp), 2026-11-23 ────────────────────────────────────

  it('obtenerOtpEnvioModo(): GET /loyalty/config/otp-envio-modo', () => {
    service.obtenerOtpEnvioModo().subscribe(res => expect(res).toEqual({ modo: 'simulado' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/otp-envio-modo`);
    expect(req.request.method).toBe('GET');
    req.flush({ modo: 'simulado' });
  });

  it('guardarOtpEnvioModo(): PUT /loyalty/config/otp-envio-modo con {modo}', () => {
    service.guardarOtpEnvioModo('real').subscribe(res => expect(res).toEqual({ modo: 'real' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/otp-envio-modo`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ modo: 'real' });
    req.flush({ modo: 'real' });
  });

  it('obtenerOtpEnvioProveedor(): GET /loyalty/config/otp-envio-proveedor', () => {
    service.obtenerOtpEnvioProveedor().subscribe(res => expect(res).toEqual({ proveedor: 'whatsapp' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/otp-envio-proveedor`);
    expect(req.request.method).toBe('GET');
    req.flush({ proveedor: 'whatsapp' });
  });

  it('guardarOtpEnvioProveedor(): PUT /loyalty/config/otp-envio-proveedor con {proveedor}', () => {
    service.guardarOtpEnvioProveedor('whatsapp').subscribe(res => expect(res).toEqual({ proveedor: 'whatsapp' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/otp-envio-proveedor`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ proveedor: 'whatsapp' });
    req.flush({ proveedor: 'whatsapp' });
  });

  it('obtenerOtpWhatsapp(): GET /loyalty/config/otp-whatsapp devuelve los 6 campos, secretos enmascarados', () => {
    const fixture = {
      phoneNumberId: '123', wabaId: 'waba-1', token: '••••••••', appSecret: null,
      templateNombre: 'verificacion_codigo', templateIdioma: 'es_MX',
    };
    service.obtenerOtpWhatsapp().subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/otp-whatsapp`);
    expect(req.request.method).toBe('GET');
    req.flush(fixture);
  });

  it('guardarOtpWhatsapp(): PUT /loyalty/config/otp-whatsapp manda SOLO las claves provistas (partial patch real)', () => {
    service.guardarOtpWhatsapp({ phoneNumberId: '456', token: 'nuevo-token' }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/otp-whatsapp`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ phoneNumberId: '456', token: 'nuevo-token' });
    req.flush({
      phoneNumberId: '456', wabaId: null, token: '••••••••', appSecret: null,
      templateNombre: 'verificacion_codigo', templateIdioma: 'es_MX',
    });
  });

  // ── Catálogos Kore configurables (2026-10-26) ───────────────────────────

  it('listarConceptosKore(): GET /loyalty/config/conceptos-kore sin query param cuando soloActivos no viene', () => {
    const fixture: LoyaltyKoreConcepto[] = [
      { id: 1, koreId: 'k1', nombre: 'COBRO TICKET SENCILLO', abreviatura: 'CBT', tipo: 'ENTRADA', acumulaPuntos: true, activo: true },
    ];
    service.listarConceptosKore().subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/conceptos-kore`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('soloActivos')).toBe(false);
    req.flush(fixture);
  });

  it('listarConceptosKore(true): agrega ?soloActivos=true', () => {
    service.listarConceptosKore(true).subscribe();
    const req = httpMock.expectOne(r =>
      r.url === `${apiBase}/loyalty/config/conceptos-kore` && r.params.get('soloActivos') === 'true');
    req.flush([]);
  });

  it('sincronizarConceptosKore(): POST /loyalty/config/conceptos-kore/sync', () => {
    const fixture: LoyaltySyncKoreResult = { nuevos: 2, actualizados: 1, desactivados: 0 };
    service.sincronizarConceptosKore().subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/conceptos-kore/sync`);
    expect(req.request.method).toBe('POST');
    req.flush(fixture);
  });

  it('actualizarConceptoKore(): PATCH /loyalty/config/conceptos-kore/:id con {acumulaPuntos}', () => {
    service.actualizarConceptoKore(1, true).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/conceptos-kore/1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ acumulaPuntos: true });
    req.flush({});
  });

  it('listarFormasPagoKore(): GET /loyalty/config/formas-pago-kore', () => {
    const fixture: LoyaltyKoreFormaPago[] = [
      {
        id: 1, koreId: 'f1', nombre: 'PUNTOS', acumulaPuntos: false, esPuntos: true,
        koreAcumulaPuntosHint: false, koreEsPuntosHint: true, activo: true,
      },
    ];
    service.listarFormasPagoKore().subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/formas-pago-kore`);
    expect(req.request.method).toBe('GET');
    req.flush(fixture);
  });

  it('sincronizarFormasPagoKore(): POST /loyalty/config/formas-pago-kore/sync', () => {
    const fixture: LoyaltySyncKoreResult = { nuevos: 0, actualizados: 3, desactivados: 1 };
    service.sincronizarFormasPagoKore().subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/formas-pago-kore/sync`);
    expect(req.request.method).toBe('POST');
    req.flush(fixture);
  });

  it('actualizarFormaPagoKore(): PATCH /loyalty/config/formas-pago-kore/:id con el payload provisto', () => {
    service.actualizarFormaPagoKore(5, { esPuntos: true }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/formas-pago-kore/5`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ esPuntos: true });
    req.flush({});
  });

  // Catálogo de niveles Kore (2026-11-06) — porcentaje autoritativo de Kore.
  it('listarNivelesKore(): GET /loyalty/config/niveles-kore', () => {
    const fixture: LoyaltyKoreNivel[] = [
      { id: 1, koreId: 'n1', nombre: 'Bronce', porcentaje: 1.5, color: '#CD7F32', esInicial: true, activo: true },
    ];
    service.listarNivelesKore().subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/niveles-kore`);
    expect(req.request.method).toBe('GET');
    req.flush(fixture);
  });

  it('sincronizarNivelesKore(): POST /loyalty/config/niveles-kore/sync', () => {
    const fixture: LoyaltySyncKoreResult = { nuevos: 1, actualizados: 2, desactivados: 0 };
    service.sincronizarNivelesKore().subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/niveles-kore/sync`);
    expect(req.request.method).toBe('POST');
    req.flush(fixture);
  });

  it('actualizarNivelKore(): PATCH /loyalty/config/niveles-kore/:id con esInicial', () => {
    service.actualizarNivelKore(3, true).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/niveles-kore/3`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ esInicial: true });
    req.flush({});
  });

  // Foto de clientes (2026-10-29) — Folder ID de Drive para drive-loyalty-foto.service.js.
  it('obtenerFotoFolderId(): GET /loyalty/config/foto-folder', () => {
    service.obtenerFotoFolderId().subscribe(res => expect(res).toEqual({ folderId: 'abc123' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/foto-folder`);
    expect(req.request.method).toBe('GET');
    req.flush({ folderId: 'abc123' });
  });

  it('guardarFotoFolderId(): PUT /loyalty/config/foto-folder con { folderId }', () => {
    service.guardarFotoFolderId('nuevo-id').subscribe(res => expect(res).toEqual({ folderId: 'nuevo-id' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/config/foto-folder`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ folderId: 'nuevo-id' });
    req.flush({ folderId: 'nuevo-id' });
  });

  // Buscador de la bandeja de Kore (2026-10-29) — mismo endpoint, nuevo param opcional `search`.
  describe('listarPendientesRevisionKore()', () => {
    it('sin search: GET /loyalty/cards/pendientes-revision-kore solo con page/limit', () => {
      service.listarPendientesRevisionKore(2, 10).subscribe();
      const req = httpMock.expectOne(r =>
        r.url === `${apiBase}/loyalty/cards/pendientes-revision-kore` &&
        r.params.get('page') === '2' &&
        r.params.get('limit') === '10' &&
        !r.params.has('search'));
      expect(req.request.method).toBe('GET');
      req.flush({ cards: [], total: 0, page: 2, limit: 10, pages: 1 });
    });

    it('con search: lo manda como query param', () => {
      service.listarPendientesRevisionKore(1, 20, 'Juan').subscribe();
      const req = httpMock.expectOne(r =>
        r.url === `${apiBase}/loyalty/cards/pendientes-revision-kore` &&
        r.params.get('search') === 'Juan');
      expect(req.request.method).toBe('GET');
      req.flush({ cards: [], total: 0, page: 1, limit: 20, pages: 1 });
    });
  });

  // Reporte "Puntos por vencer" (2026-11-03).
  describe('obtenerTarjetasPorVencer()', () => {
    it('GET /loyalty/cards/por-vencer con `dias` como query param (default 30)', () => {
      service.obtenerTarjetasPorVencer().subscribe(res => expect(res).toEqual({ tarjetas: [] }));
      const req = httpMock.expectOne(r =>
        r.url === `${apiBase}/loyalty/cards/por-vencer` &&
        r.params.get('dias') === '30');
      expect(req.request.method).toBe('GET');
      req.flush({ tarjetas: [] });
    });

    it('manda el valor de `dias` que se le pase', () => {
      service.obtenerTarjetasPorVencer(15).subscribe(res => expect(res).toEqual({ tarjetas: [] }));
      const req = httpMock.expectOne(r =>
        r.url === `${apiBase}/loyalty/cards/por-vencer` &&
        r.params.get('dias') === '15');
      req.flush({ tarjetas: [] });
    });
  });

  // Buscador del tab "Pendientes de import" (2026-10-29) — mismo patrón que
  // listarPendientesRevisionKore: param `search` opcional, solo se manda con contenido.
  describe('listarPendientes()', () => {
    it('sin search: GET /loyalty/import/pendientes solo con page/limit', () => {
      service.listarPendientes(2, 10).subscribe();
      const req = httpMock.expectOne(r =>
        r.url === `${apiBase}/loyalty/import/pendientes` &&
        r.params.get('page') === '2' &&
        r.params.get('limit') === '10' &&
        !r.params.has('search'));
      expect(req.request.method).toBe('GET');
      req.flush({ grupos: [], total: 0, totalRegistros: 0, page: 2, limit: 10, pages: 1 });
    });

    it('con search: lo manda como query param', () => {
      service.listarPendientes(1, 50, 'Juan').subscribe();
      const req = httpMock.expectOne(r =>
        r.url === `${apiBase}/loyalty/import/pendientes` &&
        r.params.get('search') === 'Juan');
      expect(req.request.method).toBe('GET');
      req.flush({ grupos: [], total: 0, totalRegistros: 0, page: 1, limit: 50, pages: 1 });
    });
  });
});
