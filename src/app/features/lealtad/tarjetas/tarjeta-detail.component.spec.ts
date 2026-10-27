import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError, NEVER } from 'rxjs';
import { TarjetaDetailComponent } from './tarjeta-detail.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { AuthService } from '../../../core/services/auth.service';
import { LoyaltyCard, LoyaltyMovimiento, LoyaltyTierHistoryEntry } from '../../../core/models/loyalty.model';

/**
 * RED (PR6, task 6.6-6.7) — el placeholder de PR5 solo muestra "Tarjeta #id";
 * el detalle real (header, ledger, historial de niveles, acciones por
 * permiso) llega acá.
 */
const CARD: LoyaltyCard = { id: 9, telefono: '5512345678', nombre: 'Juan Pérez', nivel: 'Plata', saldoPuntos: 150, activa: true };
const MOVS: LoyaltyMovimiento[] = [{
  id: 1, cardId: 9, tipo: 'ACUMULACION', puntos: 50, saldoResultante: 150, montoVenta: 1000,
  porcentajeAplicado: 5, nivelAplicado: 'Plata', centroCostoId: 1, reasonId: null, justificacion: null,
  origen: 'manual', referenciaExterna: null, usuarioId: 'u1', usuarioNombre: 'Staff', createdAt: '2026-10-15T00:00:00Z',
}];
const TIER_HIST: LoyaltyTierHistoryEntry[] = [{
  id: 1, cardId: 9, nivelAnterior: 'Bronce', nivelNuevo: 'Plata', motivo: 'Ascenso', usuarioId: 'u1', usuarioNombre: 'Staff', at: '2026-10-01T00:00:00Z',
}];
// Piso de 1.8s del Lottie (ver tarjeta-detail.component.ts, LOTTIE_MIN_MS) — hay que destaparlo
// con tick() en cualquier test que dependa de `comp.card` tras cargarCard()/confirmarCambiarNip().
const LOTTIE_MIN_MS = 1800;

function crearLoyaltySpy(): jasmine.SpyObj<LoyaltyService> {
  const svc = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
    'obtener', 'obtenerParaEditar', 'listarMovimientos', 'listarNiveles', 'editarTarjeta', 'cambiarNip', 'cambiarNivel',
    'listarSucursales', 'listarReasons',
  ]);
  // Copia fresca en cada test — el componente muta `this.card` directo
  // (onMovimientoRegistrado/guardarEdicion/guardarNivel), reusar la misma
  // referencia de CARD entre tests la corrompería entre ellos.
  svc.obtener.and.returnValue(of({ ...CARD }));
  // "Datos adicionales" (2026-10-23) — iniciarEdicion() lo pide aparte, ver tarjeta-detail.component.ts.
  svc.obtenerParaEditar.and.returnValue(of({ ...CARD }));
  svc.listarMovimientos.and.returnValue(of({ movimientos: MOVS, page: 1, pages: 1, total: 1, limit: 20 }));
  svc.listarNiveles.and.returnValue(of(TIER_HIST));
  // Detalle expandible de movimiento (2026-10-19) — resuelve centroCostoId/reasonId a nombre.
  svc.listarSucursales.and.returnValue(of([]));
  svc.listarReasons.and.returnValue(of([]));
  return svc;
}

describe('TarjetaDetailComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<TarjetaDetailComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = crearLoyaltySpy();
    const authStub = { hasPermission: () => true };

    await TestBed.configureTestingModule({
      declarations: [TarjetaDetailComponent],
      providers: [
        { provide: LoyaltyService, useValue: loyalty },
        { provide: AuthService, useValue: authStub },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: '9' }) } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(TarjetaDetailComponent);
  });

  it('renders the card header ("No. de tarjeta" = phone), nivel, saldo and ledger/history rows', (done) => {
    // Tiempo real (no fakeAsync): el piso del Lottie monta #lottieHost, que carga lottie-web real
    // y dispara un XHR real al JSON — eso no es compatible con la zona fakeAsync (la bloquea).
    expect(() => fixture.detectChanges()).not.toThrow();
    setTimeout(() => {
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('5512345678');
      expect(text).toContain('Plata');
      expect(text).toContain('Juan Pérez');
      expect(text).toContain('Acumulación');
      expect(text).toContain('Bronce');
      done();
    }, LOTTIE_MIN_MS + 200);
  });

  it('mientras carga la tarjeta: monta el host del Lottie real (loader-payment-credit-card.json) sin tronar, en vez del texto plano viejo', (done) => {
    loyalty.obtener.and.returnValue(NEVER); // nunca resuelve → queda en estado "cargando"
    fixture.detectChanges();

    const host = fixture.nativeElement.querySelector('.td-loading-lottie');
    expect(host).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Cargando tarjeta…');

    // lottie-web se importa de forma diferida (import() dinámico) — se espera un tick real
    // para que cargue el JSON real desde /lottie/loader-payment-credit-card.json (provisto por
    // el usuario, 2026-10-19) y renderice el SVG. Esto es una verificación real contra el
    // archivo real, no un mock: si el JSON estuviera mal formado o la ruta rota, lottie-web no
    // pintaría ningún <svg> adentro del host.
    setTimeout(() => {
      expect(host.querySelector('svg')).toBeTruthy();
      done();
    }, 300);
  });

  it('bug real corregido (2026-10-19): muestra "Última edición" cuando la tarjeta trae updatedByNombre', (done) => {
    loyalty.obtener.and.returnValue(of({ ...CARD, updatedByNombre: 'Admin', updatedAt: '2026-10-19T12:00:00Z' }));
    fixture.detectChanges();
    setTimeout(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Última edición: Admin');
      done();
    }, LOTTIE_MIN_MS + 200);
  });

  it('no muestra "Última edición" cuando la tarjeta nunca fue editada', (done) => {
    loyalty.obtener.and.returnValue(of({ ...CARD })); // CARD no trae updatedByNombre
    fixture.detectChanges();
    setTimeout(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('Última edición');
      done();
    }, LOTTIE_MIN_MS + 200);
  });

  it('bug real corregido (2026-10-20, actualizado 2026-10-27 a fila separada): muestra la promoción aplicada en su propio movimiento', (done) => {
    // 2026-10-27 (pedido explícito del usuario): nivel y promoción ya NO comparten una sola fila
    // combinada — este fixture representa la fila de promoción sola (nivelAplicado null,
    // porcentajeAplicado = el % propio de la promo, no el total combinado).
    loyalty.listarMovimientos.and.returnValue(of({
      movimientos: [{ ...MOVS[0], nivelAplicado: null, porcentajeAplicado: 3, promocionNombre: 'Buen Fin', promocionPorcentaje: 3 }],
      page: 1, pages: 1, total: 1, limit: 20,
    }));
    fixture.detectChanges();
    setTimeout(() => {
      fixture.detectChanges();
      fixture.componentInstance.toggleMovimiento(fixture.componentInstance.movimientos[0]);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Promoción aplicada');
      expect(text).toContain('Buen Fin (+3%)');
      done();
    }, LOTTIE_MIN_MS + 200);
  });

  it('sin promoción vigente: no muestra la fila "Promoción aplicada" (regresión)', (done) => {
    fixture.detectChanges();
    setTimeout(() => {
      fixture.detectChanges();
      fixture.componentInstance.toggleMovimiento(fixture.componentInstance.movimientos[0]);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('Promoción aplicada');
      done();
    }, LOTTIE_MIN_MS + 200);
  });

  it('desglose del cálculo (2026-10-27): sin montoBaseCalculo (fila vieja), usa montoVenta y no aclara prorrateo', (done) => {
    fixture.detectChanges();
    setTimeout(() => {
      fixture.detectChanges();
      fixture.componentInstance.toggleMovimiento(fixture.componentInstance.movimientos[0]);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Cálculo');
      expect(text).toContain('1,000.00 × 5% = 50.00 puntos');
      expect(text).not.toContain('Sobre');
      done();
    }, LOTTIE_MIN_MS + 200);
  });

  it('desglose del cálculo (2026-10-27): con prorrateo (webhook, formas de pago mixtas), usa montoBaseCalculo y aclara la porción', (done) => {
    loyalty.listarMovimientos.and.returnValue(of({
      movimientos: [{ ...MOVS[0], montoVenta: 1000, montoBaseCalculo: 600, puntos: 30 }],
      page: 1, pages: 1, total: 1, limit: 20,
    }));
    fixture.detectChanges();
    setTimeout(() => {
      fixture.detectChanges();
      fixture.componentInstance.toggleMovimiento(fixture.componentInstance.movimientos[0]);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('600.00 × 5% = 30.00 puntos');
      expect(text).toContain('Sobre');
      expect(text).toContain('de un total de venta de 1,000.00');
      done();
    }, LOTTIE_MIN_MS + 200);
  });

  it('desglose del cálculo (2026-10-27): montoBaseCalculo igual a montoVenta (sin prorrateo real), no aclara nada de más', (done) => {
    loyalty.listarMovimientos.and.returnValue(of({
      movimientos: [{ ...MOVS[0], montoVenta: 1000, montoBaseCalculo: 1000 }],
      page: 1, pages: 1, total: 1, limit: 20,
    }));
    fixture.detectChanges();
    setTimeout(() => {
      fixture.detectChanges();
      fixture.componentInstance.toggleMovimiento(fixture.componentInstance.movimientos[0]);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('Sobre');
      done();
    }, LOTTIE_MIN_MS + 200);
  });

  it('hides every gated action when the user has none of the loyalty permissions', (done) => {
    const auth = TestBed.inject(AuthService) as any;
    auth.hasPermission = () => false;
    fixture.detectChanges();
    setTimeout(() => {
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent as string;
      expect(text).not.toContain('Cambiar NIP');
      expect(text).not.toContain('Registrar acumulación');
      expect(text).not.toContain('Registrar ajuste');
      done();
    }, LOTTIE_MIN_MS + 200);
  });
});

describe('TarjetaDetailComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let auth: jasmine.SpyObj<AuthService>;
  let comp: TarjetaDetailComponent;

  beforeEach(() => {
    loyalty = crearLoyaltySpy();
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    auth.hasPermission.and.returnValue(true);
    const route = { snapshot: { paramMap: convertToParamMap({ id: '9' }) } } as unknown as ActivatedRoute;
    comp = new TarjetaDetailComponent(route, loyalty, auth);
  });

  it('ngOnInit(): loads the card, its ledger and its tier history', fakeAsync(() => {
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    expect(comp.card).toEqual(CARD);
    expect(comp.movimientos).toEqual(MOVS);
    expect(comp.tierHistory).toEqual(TIER_HIST);
  }));

  it('historial plegable (2026-10-20): ambas secciones arrancan cerradas', () => {
    expect(comp.historialMovAbierto).toBe(false);
    expect(comp.historialNivelesAbierto).toBe(false);

    comp.toggleHistorialMov();
    expect(comp.historialMovAbierto).toBe(true);
    comp.toggleHistorialMov();
    expect(comp.historialMovAbierto).toBe(false);

    comp.toggleHistorialNiveles();
    expect(comp.historialNivelesAbierto).toBe(true);
    comp.toggleHistorialNiveles();
    expect(comp.historialNivelesAbierto).toBe(false);
  });

  it('tipoLabel(): traduce el enum crudo a una etiqueta legible (rediseño 2026-10-20)', () => {
    expect(comp.tipoLabel('ACUMULACION')).toBe('Acumulación');
    expect(comp.tipoLabel('CANJE')).toBe('Canje');
    expect(comp.tipoLabel('AJUSTE')).toBe('Ajuste');
    expect(comp.tipoLabel('MIGRACION')).toBe('Migración');
  });

  describe('detalle expandible de movimiento (2026-10-19)', () => {
    it('toggleMovimiento(): abre y vuelve a cerrar el mismo movimiento', () => {
      comp.ngOnInit();
      expect(comp.movimientosExpandidosIds.size).toBe(0);

      comp.toggleMovimiento(MOVS[0]);
      expect(comp.movimientosExpandidosIds.has(MOVS[0].id)).toBe(true);

      comp.toggleMovimiento(MOVS[0]);
      expect(comp.movimientosExpandidosIds.has(MOVS[0].id)).toBe(false);
    });

    it('toggleMovimiento(): expandir una segunda fila NO colapsa la primera (2026-10-27, ya no es acordeón)', () => {
      comp.ngOnInit();
      const segundo: LoyaltyMovimiento = { ...MOVS[0], id: 2 };

      comp.toggleMovimiento(MOVS[0]);
      comp.toggleMovimiento(segundo);

      expect(comp.movimientosExpandidosIds.has(MOVS[0].id)).toBe(true);
      expect(comp.movimientosExpandidosIds.has(segundo.id)).toBe(true);

      comp.toggleMovimiento(MOVS[0]);
      expect(comp.movimientosExpandidosIds.has(MOVS[0].id)).toBe(false);
      expect(comp.movimientosExpandidosIds.has(segundo.id)).toBe(true);
    });

    it('nombreSucursal()/nombreReason(): resuelven por id, o "#id" si no está en el catálogo cargado', () => {
      loyalty.listarSucursales.and.returnValue(of([{ id: 1, clave: 'HGO', sucursal: 'TyC Hidalgo', isActive: true, participaLealtad: true, permiteCanjeLealtad: true, serieFacturacion: null }]));
      loyalty.listarReasons.and.returnValue(of([{ id: 3, clave: 'cortesia', nombre: 'Cortesía', activo: true, puntosFijos: null }]));
      comp.ngOnInit();

      expect(comp.nombreSucursal(1)).toBe('TyC Hidalgo');
      expect(comp.nombreReason(3)).toBe('Cortesía');
      expect(comp.nombreSucursal(999)).toBe('#999');
      expect(comp.nombreReason(null)).toBe('—');
    });
  });

  it('puedeMovimiento("acumulacion"): false on an inactive card even with permission (spec: "Deactivated card blocks new movements")', fakeAsync(() => {
    loyalty.obtener.and.returnValue(of({ ...CARD, activa: false }));
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    expect(comp.puedeMovimiento('acumulacion')).toBe(false);
    expect(comp.puedeMovimiento('canje')).toBe(false);
  }));

  it('puedeMovimiento("ajuste"): true on an inactive card when loyalty:ajustes is granted', fakeAsync(() => {
    loyalty.obtener.and.returnValue(of({ ...CARD, activa: false }));
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    expect(comp.puedeMovimiento('ajuste')).toBe(true);
  }));

  it('onMovimientoRegistrado(): updates saldoPuntos, prepends the new entry and closes the modal', fakeAsync(() => {
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    comp.movimientoMode = 'acumulacion';
    const nuevo: LoyaltyMovimiento = { ...MOVS[0], id: 2, puntos: 20, saldoResultante: 170 };
    comp.onMovimientoRegistrado({ movimiento: nuevo, saldoPuntos: 170 });
    expect(comp.card!.saldoPuntos).toBe(170);
    expect(comp.movimientos[0]).toEqual(nuevo);
    expect(comp.movimientoMode).toBeNull();
  }));

  // 2026-10-27 (pedido explícito del usuario): con promoción vigente, registrarAcumulacion
  // devuelve DOS filas (nivel + promoción) — ambas deben aparecer en el detalle de movimientos,
  // la de promoción primero (se creó después, mismo orden que listarMovimientos() trae del backend).
  it('onMovimientoRegistrado(): con movimientoPromocion, prepends BOTH entries (promoción primero)', fakeAsync(() => {
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    comp.movimientoMode = 'acumulacion';
    const nivel: LoyaltyMovimiento = { ...MOVS[0], id: 3, puntos: 50, saldoResultante: 150, promocionNombre: null };
    const promo: LoyaltyMovimiento = { ...MOVS[0], id: 4, puntos: 30, saldoResultante: 180, nivelAplicado: null, promocionNombre: 'Buen Fin' };
    comp.onMovimientoRegistrado({ movimiento: nivel, movimientoPromocion: promo, saldoPuntos: 180 });
    expect(comp.card!.saldoPuntos).toBe(180);
    expect(comp.movimientos[0]).toEqual(promo);
    expect(comp.movimientos[1]).toEqual(nivel);
    expect(comp.movimientoMode).toBeNull();
  }));

  it('guardarNivel(): rejects submitting the same tier the card already has', fakeAsync(() => {
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    comp.nuevoNivel = 'Plata';
    comp.guardarNivel();
    expect(loyalty.cambiarNivel).not.toHaveBeenCalled();
    expect(comp.nivelError).toBeTruthy();
  }));

  it('guardarNivel(): on success, updates the card tier and reloads the history', fakeAsync(() => {
    loyalty.cambiarNivel.and.returnValue(of({ ...CARD, nivel: 'Oro' }));
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    loyalty.listarNiveles.calls.reset();
    comp.nuevoNivel = 'Oro';
    comp.motivoNivel = 'Cliente VIP';
    comp.guardarNivel();
    expect(loyalty.cambiarNivel).toHaveBeenCalledWith(9, 'Oro', 'Cliente VIP');
    expect(comp.card!.nivel).toBe('Oro');
    expect(loyalty.listarNiveles).toHaveBeenCalled();
    expect(comp.showNivelForm).toBe(false);
  }));

  it('pedirCambiarNip(): pide confirmación antes de llamar al servicio', fakeAsync(() => {
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    comp.pedirCambiarNip();
    expect(comp.showConfirmNip).toBe(true);
    expect(loyalty.cambiarNip).not.toHaveBeenCalled();
  }));

  it('cancelarCambiarNip(): cancela sin llamar al servicio', () => {
    comp.ngOnInit();
    comp.showConfirmNip = true;
    comp.cancelarCambiarNip();
    expect(comp.showConfirmNip).toBe(false);
    expect(loyalty.cambiarNip).not.toHaveBeenCalled();
  });

  it('confirmarCambiarNip(): reveals the new plaintext NIP exactly once (spec: "Previous NIP is never exposed")', fakeAsync(() => {
    loyalty.cambiarNip.and.returnValue(of({ nip: '3344' }));
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    comp.showConfirmNip = true;
    comp.confirmarCambiarNip();
    expect(comp.showConfirmNip).toBe(false);
    expect(comp.nipSaving).toBe(false);
    expect(comp.nipReveal).toEqual({ nombre: 'Juan Pérez', nip: '3344' });
    tick(LOTTIE_MIN_MS); // confirmarCambiarNip() dispara cargarCard() de nuevo al final (refresh)
  }));

  it('confirmarCambiarNip(): refresca la tarjeta — el backend ya registra quién/cuándo (bug real corregido 2026-10-19)', fakeAsync(() => {
    loyalty.cambiarNip.and.returnValue(of({ nip: '3344' }));
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    loyalty.obtener.calls.reset();

    comp.confirmarCambiarNip();

    expect(loyalty.obtener).toHaveBeenCalledWith(comp.id);
    tick(LOTTIE_MIN_MS); // flush del cargarCard() disparado por el refresh
  }));

  it('confirmarCambiarNip(): en error, limpia el loading y muestra un mensaje sin revelar NIP', fakeAsync(() => {
    loyalty.cambiarNip.and.returnValue(throwError(() => ({ error: { error: 'Server error' } })));
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);

    comp.confirmarCambiarNip();

    expect(comp.nipSaving).toBe(false);
    expect(comp.nipError).toBe('Server error');
    expect(comp.nipReveal).toBeNull();
  }));

  it('iniciarEdicion(): pide "datos adicionales" vía obtenerParaEditar y los precarga en editDatos', fakeAsync(() => {
    loyalty.obtenerParaEditar.and.returnValue(of({ ...CARD, apodo: 'Juancho', colonia: 'Centro' }));
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    comp.iniciarEdicion();
    expect(loyalty.obtenerParaEditar).toHaveBeenCalledWith(CARD.id);
    expect(comp.editDatos.apodo).toBe('Juancho');
    expect(comp.editDatos.colonia).toBe('Centro');
  }));

  it('guardarEdicion(): incluye editDatos en el payload de editarTarjeta', fakeAsync(() => {
    loyalty.obtenerParaEditar.and.returnValue(of({ ...CARD, apodo: 'Juancho' }));
    loyalty.editarTarjeta.and.returnValue(of({ ...CARD }));
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    comp.iniciarEdicion();
    comp.guardarEdicion();
    expect(loyalty.editarTarjeta).toHaveBeenCalledWith(CARD.id, jasmine.objectContaining({ apodo: 'Juancho' }));
  }));

  it('guardarEdicion(): surfaces the backend 409 duplicate-phone message (spec: "Phone edit to an already-used number is rejected")', fakeAsync(() => {
    loyalty.editarTarjeta.and.returnValue(throwError(() => ({ error: { error: 'El teléfono ya está en uso.' } })));
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    comp.iniciarEdicion();
    comp.editTelefono = '5500000000';
    comp.guardarEdicion();
    expect(comp.editError).toBe('El teléfono ya está en uso.');
    expect(comp.editMode).toBe(true);
  }));

  it('guardarEdicion(): on success, updates the card and exits edit mode (name/phone/activa only — saldoPuntos/nivel untouched)', fakeAsync(() => {
    loyalty.editarTarjeta.and.returnValue(of({ ...CARD, nombre: 'Juan P. Actualizado' }));
    comp.ngOnInit();
    tick(LOTTIE_MIN_MS);
    comp.iniciarEdicion();
    comp.editNombre = 'Juan P. Actualizado';
    comp.guardarEdicion();
    expect(comp.card!.nombre).toBe('Juan P. Actualizado');
    expect(comp.card!.saldoPuntos).toBe(150);
    expect(comp.editMode).toBe(false);
  }));
});
