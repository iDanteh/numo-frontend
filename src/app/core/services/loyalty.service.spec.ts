import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { LoyaltyService } from './loyalty.service';
import { ApiService } from './api.service';
import {
  LoyaltyCard, LoyaltyCardListResult, LoyaltyCrearTarjetaResult, LoyaltyMovimientoResult,
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
      cards: [{ id: 1, telefono: '5512345678', nombre: 'Juan', nivel: 'Bronce', saldoPuntos: 0, activa: true }],
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
      card: { id: 2, telefono: '5512345679', nombre: 'Ana', nivel: 'Bronce', saldoPuntos: 0, activa: true },
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
    const fixture: LoyaltyCard = { id: 3, telefono: '5500000000', nombre: 'Luis', nivel: 'Oro', saldoPuntos: 100, activa: true };
    service.obtener(3).subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3`);
    expect(req.request.method).toBe('GET');
    req.flush(fixture);
  });

  it('editarTarjeta(): PATCH /loyalty/cards/:id con solo los campos provistos', () => {
    service.editarTarjeta(3, { nombre: 'Luis Nuevo' }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ nombre: 'Luis Nuevo' });
    req.flush({});
  });

  it('cambiarNip(): POST /loyalty/cards/:id/nip devuelve {nip} en texto plano', () => {
    service.cambiarNip(3).subscribe(res => expect(res).toEqual({ nip: '9012' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/nip`);
    expect(req.request.method).toBe('POST');
    req.flush({ nip: '9012' });
  });

  it('cambiarNivel(): PUT /loyalty/cards/:id/nivel con nuevoNivel y motivo', () => {
    service.cambiarNivel(3, 'Plata', 'Cliente frecuente').subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/nivel`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ nivel: 'Plata', motivo: 'Cliente frecuente' });
    req.flush({});
  });

  it('listarMovimientos(): GET /loyalty/cards/:id/movimientos con paginación', () => {
    service.listarMovimientos(3, 2, 10).subscribe();
    const req = httpMock.expectOne(r =>
      r.url === `${apiBase}/loyalty/cards/3/movimientos` && r.params.get('page') === '2' && r.params.get('limit') === '10');
    expect(req.request.method).toBe('GET');
    req.flush({ movimientos: [], page: 2, pages: 1, total: 0, limit: 10 });
  });

  it('listarNiveles(): GET /loyalty/cards/:id/niveles', () => {
    service.listarNiveles(3).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/niveles`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('registrarAcumulacion(): POST /loyalty/cards/:id/acumulaciones', () => {
    const fixture: LoyaltyMovimientoResult = {
      movimiento: {
        id: 10, cardId: 3, tipo: 'ACUMULACION', puntos: 50, saldoResultante: 150,
        montoVenta: 1000, porcentajeAplicado: 5, nivelAplicado: 'Plata', centroCostoId: 7,
        reasonId: null, justificacion: null, origen: 'manual', referenciaExterna: null,
        usuarioId: 'u1', usuarioNombre: 'Staff', createdAt: '2026-10-15T00:00:00Z',
      },
      saldoPuntos: 150,
    };
    service.registrarAcumulacion(3, { serieFolio: 'A0-260605320' })
      .subscribe(res => expect(res).toEqual(fixture));
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/acumulaciones`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ serieFolio: 'A0-260605320' });
    req.flush(fixture);
  });

  it('registrarCanje(): POST /loyalty/cards/:id/canjes', () => {
    service.registrarCanje(3, { puntos: 60, serie: 'A0' }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/cards/3/canjes`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ puntos: 60, serie: 'A0' });
    req.flush({});
  });

  it('registrarAjuste(): POST /loyalty/cards/:id/ajustes', () => {
    service.registrarAjuste(3, { puntos: 20, reasonId: 1, justificacion: 'Bono por cumpleaños' }).subscribe();
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
    service.crearReason({ clave: 'descuento', nombre: 'Descuento', puntosFijos: -50 }).subscribe();
    const req = httpMock.expectOne(`${apiBase}/loyalty/reasons`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ clave: 'descuento', nombre: 'Descuento', puntosFijos: -50 });
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

  it('consultaPublica(): POST /loyalty/public/consulta con {telefono, nip}, respuesta mínima (D8, sin actividad reciente)', () => {
    service.consultaPublica('5512345678', '1234').subscribe(res =>
      expect(res).toEqual({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120 }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/consulta`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefono: '5512345678', nip: '1234' });
    req.flush({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120 });
  });

  it('solicitarCodigoRecuperacion(): POST /loyalty/public/recuperacion/solicitar con {telefono}', () => {
    service.solicitarCodigoRecuperacion('5512345678').subscribe(res =>
      expect(res).toEqual({ mensaje: 'Si el teléfono está registrado…', codigoDev: '654321' }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/recuperacion/solicitar`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefono: '5512345678' });
    req.flush({ mensaje: 'Si el teléfono está registrado…', codigoDev: '654321' });
  });

  it('confirmarCodigoConsulta(): POST /loyalty/public/consulta/confirmar con {telefono, codigo}, respuesta mínima', () => {
    service.confirmarCodigoConsulta('5512345678', '654321').subscribe(res =>
      expect(res).toEqual({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120 }));
    const req = httpMock.expectOne(`${apiBase}/loyalty/public/consulta/confirmar`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ telefono: '5512345678', codigo: '654321' });
    req.flush({ nombre: 'Juan', nivel: 'Plata', saldoPuntos: 120 });
  });
});
