import { TestBed, ComponentFixture } from '@angular/core/testing';
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

function crearLoyaltySpy(): jasmine.SpyObj<LoyaltyService> {
  const svc = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
    'obtener', 'listarMovimientos', 'listarNiveles', 'editarTarjeta', 'cambiarNip', 'cambiarNivel',
    'listarSucursales', 'listarReasons',
  ]);
  // Copia fresca en cada test — el componente muta `this.card` directo
  // (onMovimientoRegistrado/guardarEdicion/guardarNivel), reusar la misma
  // referencia de CARD entre tests la corrompería entre ellos.
  svc.obtener.and.returnValue(of({ ...CARD }));
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

  it('renders the card header ("No. de tarjeta" = phone), nivel, saldo and ledger/history rows', () => {
    expect(() => fixture.detectChanges()).not.toThrow();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('5512345678');
    expect(text).toContain('Plata');
    expect(text).toContain('Juan Pérez');
    expect(text).toContain('ACUMULACION');
    expect(text).toContain('Bronce');
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

  it('bug real corregido (2026-10-19): muestra "Última edición" cuando la tarjeta trae updatedByNombre', () => {
    loyalty.obtener.and.returnValue(of({ ...CARD, updatedByNombre: 'Admin', updatedAt: '2026-10-19T12:00:00Z' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Última edición: Admin');
  });

  it('no muestra "Última edición" cuando la tarjeta nunca fue editada', () => {
    loyalty.obtener.and.returnValue(of({ ...CARD })); // CARD no trae updatedByNombre
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Última edición');
  });

  it('hides every gated action when the user has none of the loyalty permissions', () => {
    const auth = TestBed.inject(AuthService) as any;
    auth.hasPermission = () => false;
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Cambiar NIP');
    expect(text).not.toContain('Registrar acumulación');
    expect(text).not.toContain('Registrar ajuste');
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

  it('ngOnInit(): loads the card, its ledger and its tier history', () => {
    comp.ngOnInit();
    expect(comp.card).toEqual(CARD);
    expect(comp.movimientos).toEqual(MOVS);
    expect(comp.tierHistory).toEqual(TIER_HIST);
  });

  describe('detalle expandible de movimiento (2026-10-19)', () => {
    it('toggleMovimiento(): abre y vuelve a cerrar el mismo movimiento', () => {
      comp.ngOnInit();
      expect(comp.movimientoExpandidoId).toBeNull();

      comp.toggleMovimiento(MOVS[0]);
      expect(comp.movimientoExpandidoId).toBe(MOVS[0].id);

      comp.toggleMovimiento(MOVS[0]);
      expect(comp.movimientoExpandidoId).toBeNull();
    });

    it('nombreSucursal()/nombreReason(): resuelven por id, o "#id" si no está en el catálogo cargado', () => {
      loyalty.listarSucursales.and.returnValue(of([{ id: 1, clave: 'HGO', sucursal: 'TyC Hidalgo', isActive: true, participaLealtad: true, permiteCanjeLealtad: true, serieFacturacion: null }]));
      loyalty.listarReasons.and.returnValue(of([{ id: 3, clave: 'cortesia', nombre: 'Cortesía', signoPermitido: 'POSITIVO', activo: true }]));
      comp.ngOnInit();

      expect(comp.nombreSucursal(1)).toBe('TyC Hidalgo');
      expect(comp.nombreReason(3)).toBe('Cortesía');
      expect(comp.nombreSucursal(999)).toBe('#999');
      expect(comp.nombreReason(null)).toBe('—');
    });
  });

  it('puedeMovimiento("acumulacion"): false on an inactive card even with permission (spec: "Deactivated card blocks new movements")', () => {
    loyalty.obtener.and.returnValue(of({ ...CARD, activa: false }));
    comp.ngOnInit();
    expect(comp.puedeMovimiento('acumulacion')).toBe(false);
    expect(comp.puedeMovimiento('canje')).toBe(false);
  });

  it('puedeMovimiento("ajuste"): true on an inactive card when loyalty:ajustes is granted', () => {
    loyalty.obtener.and.returnValue(of({ ...CARD, activa: false }));
    comp.ngOnInit();
    expect(comp.puedeMovimiento('ajuste')).toBe(true);
  });

  it('onMovimientoRegistrado(): updates saldoPuntos, prepends the new entry and closes the modal', () => {
    comp.ngOnInit();
    comp.movimientoMode = 'acumulacion';
    const nuevo: LoyaltyMovimiento = { ...MOVS[0], id: 2, puntos: 20, saldoResultante: 170 };
    comp.onMovimientoRegistrado({ movimiento: nuevo, saldoPuntos: 170 });
    expect(comp.card!.saldoPuntos).toBe(170);
    expect(comp.movimientos[0]).toEqual(nuevo);
    expect(comp.movimientoMode).toBeNull();
  });

  it('guardarNivel(): rejects submitting the same tier the card already has', () => {
    comp.ngOnInit();
    comp.nuevoNivel = 'Plata';
    comp.guardarNivel();
    expect(loyalty.cambiarNivel).not.toHaveBeenCalled();
    expect(comp.nivelError).toBeTruthy();
  });

  it('guardarNivel(): on success, updates the card tier and reloads the history', () => {
    loyalty.cambiarNivel.and.returnValue(of({ ...CARD, nivel: 'Oro' }));
    comp.ngOnInit();
    loyalty.listarNiveles.calls.reset();
    comp.nuevoNivel = 'Oro';
    comp.motivoNivel = 'Cliente VIP';
    comp.guardarNivel();
    expect(loyalty.cambiarNivel).toHaveBeenCalledWith(9, 'Oro', 'Cliente VIP');
    expect(comp.card!.nivel).toBe('Oro');
    expect(loyalty.listarNiveles).toHaveBeenCalled();
    expect(comp.showNivelForm).toBe(false);
  });

  it('cambiarNip(): reveals the new plaintext NIP exactly once (spec: "Previous NIP is never exposed")', () => {
    loyalty.cambiarNip.and.returnValue(of({ nip: '3344' }));
    comp.ngOnInit();
    comp.cambiarNip();
    expect(comp.nipReveal).toEqual({ nombre: 'Juan Pérez', nip: '3344' });
  });

  it('cambiarNip(): refresca la tarjeta — el backend ya registra quién/cuándo (bug real corregido 2026-10-19)', () => {
    loyalty.cambiarNip.and.returnValue(of({ nip: '3344' }));
    comp.ngOnInit();
    loyalty.obtener.calls.reset();

    comp.cambiarNip();

    expect(loyalty.obtener).toHaveBeenCalledWith(comp.id);
  });

  it('guardarEdicion(): surfaces the backend 409 duplicate-phone message (spec: "Phone edit to an already-used number is rejected")', () => {
    loyalty.editarTarjeta.and.returnValue(throwError(() => ({ error: { error: 'El teléfono ya está en uso.' } })));
    comp.ngOnInit();
    comp.iniciarEdicion();
    comp.editTelefono = '5500000000';
    comp.guardarEdicion();
    expect(comp.editError).toBe('El teléfono ya está en uso.');
    expect(comp.editMode).toBe(true);
  });

  it('guardarEdicion(): on success, updates the card and exits edit mode (name/phone/activa only — saldoPuntos/nivel untouched)', () => {
    loyalty.editarTarjeta.and.returnValue(of({ ...CARD, nombre: 'Juan P. Actualizado' }));
    comp.ngOnInit();
    comp.iniciarEdicion();
    comp.editNombre = 'Juan P. Actualizado';
    comp.guardarEdicion();
    expect(comp.card!.nombre).toBe('Juan P. Actualizado');
    expect(comp.card!.saldoPuntos).toBe(150);
    expect(comp.editMode).toBe(false);
  });
});
