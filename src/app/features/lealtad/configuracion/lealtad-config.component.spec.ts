import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError, Subject } from 'rxjs';
import { LealtadConfigComponent } from './lealtad-config.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { SocketService } from '../../../core/services/socket.service';
import { LoyaltyPorcentajes, LoyaltyAdjustmentReason, LoyaltySucursal, LoyaltyPromotion } from '../../../core/models/loyalty.model';

/**
 * RED (PR7, Phase 7 task 7.1-7.2) — reemplaza el placeholder de PR5. Cubre
 * spec loyalty-config: % por nivel (loyalty:config vía el endpoint propio de
 * Lealtad, no config:manage), catálogo de motivos CRUD (activo/inactivo
 * independiente de histórico), flags de sucursal independientes, refresco en
 * vivo por configUpdated$ filtrado a sectionClave==='lealtad' (mismo criterio
 * que movimiento-modal.component.ts / bank-corte-panel.component.ts).
 */
const PORCENTAJES: LoyaltyPorcentajes = { Bronce: 1, Plata: 5, Oro: null };
const REASONS: LoyaltyAdjustmentReason[] = [
  { id: 1, clave: 'bono', nombre: 'Bono', signoPermitido: 'POSITIVO', activo: true, porcentaje: null },
  { id: 2, clave: 'viejo', nombre: 'Motivo viejo', signoPermitido: 'AMBOS', activo: false, porcentaje: null },
];
const SUCURSALES: LoyaltySucursal[] = [
  { id: 1, clave: 'MTY', sucursal: 'Monterrey', participaLealtad: true, permiteCanjeLealtad: true, serieFacturacion: null },
];
const PROMOCIONES: LoyaltyPromotion[] = [
  { id: 1, nombre: 'Buen Fin', fechaInicio: '2026-11-15', fechaFin: '2026-11-18', porcentajeBono: 5, activa: true },
];

function crearServicioSpy(): jasmine.SpyObj<LoyaltyService> {
  const svc = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
    'obtenerPorcentajes', 'guardarPorcentajes',
    'listarReasons', 'crearReason', 'editarReason',
    'listarSucursales', 'actualizarSucursal',
    'listarPromociones', 'crearPromocion', 'editarPromocion',
  ]);
  svc.obtenerPorcentajes.and.returnValue(of({ ...PORCENTAJES }));
  svc.listarReasons.and.returnValue(of(REASONS.map(r => ({ ...r }))));
  svc.listarSucursales.and.returnValue(of(SUCURSALES.map(s => ({ ...s }))));
  svc.listarPromociones.and.returnValue(of(PROMOCIONES.map(p => ({ ...p }))));
  return svc;
}

function crearSocketStub(): any {
  return { configUpdated$: new Subject() };
}

describe('LealtadConfigComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<LealtadConfigComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let socket: any;

  beforeEach(async () => {
    loyalty = crearServicioSpy();
    socket = crearSocketStub();

    await TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [LealtadConfigComponent],
      providers: [
        { provide: LoyaltyService, useValue: loyalty },
        { provide: SocketService, useValue: socket },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(LealtadConfigComponent);
  });

  it('renders current tier percentages, the reasons catalog (incl. inactive), sucursales and promociones', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Bono');
    expect(text).toContain('Motivo viejo');
    expect(text).toContain('Monterrey');
    expect(text).toContain('Buen Fin');
  });

  it('serieFacturacion (2026-10-19, pedido explícito del usuario): muestra "Sucursal (Serie)", ej. "CEDIS (A0)"', () => {
    loyalty.listarSucursales.and.returnValue(of([
      { id: 2, clave: 'CEDIS', sucursal: 'CEDIS', participaLealtad: true, permiteCanjeLealtad: true, serieFacturacion: 'A0' },
    ]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('CEDIS (A0)');
  });

  it('serieFacturacion ausente: muestra solo el nombre de la sucursal, sin paréntesis vacíos', () => {
    fixture.detectChanges(); // SUCURSALES por default trae serieFacturacion: null
    expect(fixture.nativeElement.textContent).toContain('Monterrey');
    expect(fixture.nativeElement.textContent).not.toContain('Monterrey (');
  });

  it('shows deactivated reasons as "Inactivo" without removing them from the catalog', () => {
    fixture.detectChanges();
    const badges: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.tl-badge'));
    const texts = badges.map(b => b.textContent?.trim());
    expect(texts).toContain('Activo');
    expect(texts).toContain('Inactivo');
  });

  it('guardarPorcentajes(): editing the Oro % input and clicking "Guardar" sends only the edited field', () => {
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="pct-oro"]');
    input.value = '8';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    loyalty.guardarPorcentajes.and.returnValue(of({ Bronce: 1, Plata: 5, Oro: 8 }));
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="pct-guardar"]');
    btn.click();
    expect(loyalty.guardarPorcentajes).toHaveBeenCalledWith({ Bronce: 1, Plata: 5, Oro: 8 });
  });

  it('toggling a sucursal checkbox calls actualizarSucursal with only that flag', () => {
    loyalty.actualizarSucursal.and.returnValue(of({ ...SUCURSALES[0], participaLealtad: false }));
    fixture.detectChanges();
    const checkbox: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="sucursal-participa-1"]');
    checkbox.dispatchEvent(new Event('change'));
    expect(loyalty.actualizarSucursal).toHaveBeenCalledWith(1, { participaLealtad: false });
  });

  it('live refresh: reloads porcentajes when configUpdated$ fires for sectionClave "lealtad"', () => {
    fixture.detectChanges();
    loyalty.obtenerPorcentajes.calls.reset();
    socket.configUpdated$.next({ sectionClave: 'lealtad', clave: 'PORCENTAJE_ORO' });
    expect(loyalty.obtenerPorcentajes).toHaveBeenCalledTimes(1);
  });

  it('live refresh: ignores configUpdated$ for other sections', () => {
    fixture.detectChanges();
    loyalty.obtenerPorcentajes.calls.reset();
    socket.configUpdated$.next({ sectionClave: 'bancos', clave: 'CORTE_PERIODO_COBRANZA' });
    expect(loyalty.obtenerPorcentajes).not.toHaveBeenCalled();
  });
});

describe('LealtadConfigComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let socket: any;
  let comp: LealtadConfigComponent;

  beforeEach(() => {
    loyalty = crearServicioSpy();
    socket = crearSocketStub();
    comp = new LealtadConfigComponent(loyalty, socket);
  });

  it('ngOnInit(): loads porcentajes, reasons and sucursales', () => {
    comp.ngOnInit();
    expect(comp.porcentajes).toEqual(PORCENTAJES);
    expect(comp.reasons.length).toBe(2);
    expect(comp.sucursales.length).toBe(1);
  });

  it('cargarPorcentajes(): populates the editable form with the current values, null when not configured (D11)', () => {
    comp.ngOnInit();
    expect(comp.pctForm).toEqual({ Bronce: 1, Plata: 5, Oro: null });
  });

  it('guardarPorcentajes(): rejects an out-of-range percentage without calling the service', () => {
    comp.ngOnInit();
    comp.pctForm.Oro = 150;
    comp.guardarPorcentajes();
    expect(loyalty.guardarPorcentajes).not.toHaveBeenCalled();
    expect(comp.pctError).toBeTruthy();
  });

  it('guardarPorcentajes(): rejects a zero or negative percentage', () => {
    comp.ngOnInit();
    comp.pctForm.Bronce = 0;
    comp.guardarPorcentajes();
    expect(loyalty.guardarPorcentajes).not.toHaveBeenCalled();
  });

  it('guardarPorcentajes(): sends only the configured (non-null) fields', () => {
    loyalty.guardarPorcentajes.and.returnValue(of({ Bronce: 1, Plata: 5, Oro: 10 }));
    comp.ngOnInit();
    comp.pctForm.Oro = 10;
    comp.guardarPorcentajes();
    expect(loyalty.guardarPorcentajes).toHaveBeenCalledWith({ Bronce: 1, Plata: 5, Oro: 10 });
  });

  it('crearReason(): requires clave and nombre before calling the service', () => {
    comp.ngOnInit();
    comp.nuevoReason = { clave: '', nombre: '', signoPermitido: 'AMBOS', porcentaje: null };
    comp.crearReason();
    expect(loyalty.crearReason).not.toHaveBeenCalled();
    expect(comp.reasonsError).toBeTruthy();
  });

  it('crearReason(): on success appends the new reason and closes the form', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 3, clave: 'descuento', nombre: 'Descuento', signoPermitido: 'NEGATIVO', activo: true, porcentaje: null };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.showNuevoReason = true;
    comp.nuevoReason = { clave: 'descuento', nombre: 'Descuento', signoPermitido: 'NEGATIVO', porcentaje: null };
    comp.crearReason();
    expect(comp.reasons).toContain(nuevo);
    expect(comp.showNuevoReason).toBe(false);
  });

  it('toggleActivoReason(): flips activo via editarReason and replaces the row in place', () => {
    const actualizado: LoyaltyAdjustmentReason = { ...REASONS[0], activo: false };
    loyalty.editarReason.and.returnValue(of(actualizado));
    comp.ngOnInit();
    comp.toggleActivoReason(comp.reasons[0]);
    expect(loyalty.editarReason).toHaveBeenCalledWith(1, { activo: false });
    expect(comp.reasons[0].activo).toBe(false);
  });

  it('guardarEdicionReason(): requires a non-empty nombre', () => {
    comp.ngOnInit();
    comp.iniciarEdicionReason(comp.reasons[0]);
    comp.editReason.nombre = '  ';
    comp.guardarEdicionReason(comp.reasons[0]);
    expect(loyalty.editarReason).not.toHaveBeenCalled();
  });

  it('guardarEdicionReason(): on success updates the row and exits edit mode', () => {
    const actualizado: LoyaltyAdjustmentReason = { ...REASONS[0], nombre: 'Bono renombrado' };
    loyalty.editarReason.and.returnValue(of(actualizado));
    comp.ngOnInit();
    comp.iniciarEdicionReason(comp.reasons[0]);
    comp.editReason.nombre = 'Bono renombrado';
    comp.guardarEdicionReason(comp.reasons[0]);
    expect(comp.reasons[0].nombre).toBe('Bono renombrado');
    expect(comp.editingReasonId).toBeNull();
  });

  it('toggleParticipa(): calls actualizarSucursal with only participaLealtad flipped', () => {
    loyalty.actualizarSucursal.and.returnValue(of({ ...SUCURSALES[0], participaLealtad: false }));
    comp.ngOnInit();
    comp.toggleParticipa(comp.sucursales[0]);
    expect(loyalty.actualizarSucursal).toHaveBeenCalledWith(1, { participaLealtad: false });
  });

  it('togglePermiteCanje(): calls actualizarSucursal with only permiteCanjeLealtad flipped (independent flags, spec "Flags are set independently")', () => {
    loyalty.actualizarSucursal.and.returnValue(of({ ...SUCURSALES[0], permiteCanjeLealtad: false }));
    comp.ngOnInit();
    comp.togglePermiteCanje(comp.sucursales[0]);
    expect(loyalty.actualizarSucursal).toHaveBeenCalledWith(1, { permiteCanjeLealtad: false });
  });

  it('surfaces the backend error message on a failed sucursal update', () => {
    loyalty.actualizarSucursal.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
    comp.ngOnInit();
    comp.toggleParticipa(comp.sucursales[0]);
    expect(comp.sucursalesError).toBe('No autorizado');
  });

  it('ngOnDestroy(): unsubscribes from configUpdated$', () => {
    comp.ngOnInit();
    comp.ngOnDestroy();
    loyalty.obtenerPorcentajes.calls.reset();
    socket.configUpdated$.next({ sectionClave: 'lealtad', clave: 'PORCENTAJE_ORO' });
    expect(loyalty.obtenerPorcentajes).not.toHaveBeenCalled();
  });

  it('mostrarGuardado(): flags the toggled row/field as saved and clears the flag after the timeout', fakeAsync(() => {
    loyalty.actualizarSucursal.and.returnValue(of({ ...SUCURSALES[0], participaLealtad: false }));
    comp.ngOnInit();
    comp.toggleParticipa(comp.sucursales[0]);

    expect(comp.sucursalGuardadoId).toBe(1);
    expect(comp.sucursalGuardadoCampo).toBe('participa');

    tick(1200);
    expect(comp.sucursalGuardadoId).toBeNull();
    expect(comp.sucursalGuardadoCampo).toBeNull();
  }));

  it('ngOnDestroy(): clears a pending save-confirmation timeout so it cannot fire after destroy', fakeAsync(() => {
    loyalty.actualizarSucursal.and.returnValue(of({ ...SUCURSALES[0], permiteCanjeLealtad: false }));
    comp.ngOnInit();
    comp.togglePermiteCanje(comp.sucursales[0]);
    expect(comp.sucursalGuardadoId).toBe(1);

    comp.ngOnDestroy();
    tick(1200); // si el timeout no se hubiera limpiado, esto lo dispararía igual

    expect(comp.sucursalGuardadoId).toBe(1); // se mantiene como quedó al destruir
    expect(comp.sucursalGuardadoCampo).toBe('canje');
  }));

  // ── Motivos con % de cálculo automático (feature nueva) ───────────────────

  it('crearReason(): incluye porcentaje (null por default) en el payload enviado', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 3, clave: 'descuento', nombre: 'Descuento', signoPermitido: 'NEGATIVO', activo: true, porcentaje: null };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.nuevoReason = { clave: 'descuento', nombre: 'Descuento', signoPermitido: 'NEGATIVO', porcentaje: null };
    comp.crearReason();
    expect(loyalty.crearReason).toHaveBeenCalledWith({ clave: 'descuento', nombre: 'Descuento', signoPermitido: 'NEGATIVO', porcentaje: null });
  });

  it('crearReason(): con porcentaje configurado lo incluye en el payload', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 3, clave: 'promo', nombre: 'Promo', signoPermitido: 'POSITIVO', activo: true, porcentaje: 15 };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.nuevoReason = { clave: 'promo', nombre: 'Promo', signoPermitido: 'POSITIVO', porcentaje: 15 };
    comp.crearReason();
    expect(loyalty.crearReason).toHaveBeenCalledWith({ clave: 'promo', nombre: 'Promo', signoPermitido: 'POSITIVO', porcentaje: 15 });
  });

  it('crearReason(): rechaza porcentaje + signoPermitido AMBOS sin llamar al servicio (mismo mensaje que el backend)', () => {
    comp.ngOnInit();
    comp.nuevoReason = { clave: 'promo', nombre: 'Promo', signoPermitido: 'AMBOS', porcentaje: 15 };
    comp.crearReason();
    expect(loyalty.crearReason).not.toHaveBeenCalled();
    expect(comp.reasonsError).toContain('AMBOS');
  });

  it('guardarEdicionReason(): incluye porcentaje en el payload', () => {
    const actualizado: LoyaltyAdjustmentReason = { ...REASONS[0], porcentaje: 20 };
    loyalty.editarReason.and.returnValue(of(actualizado));
    comp.ngOnInit();
    comp.iniciarEdicionReason(comp.reasons[0]);
    comp.editReason.porcentaje = 20;
    comp.guardarEdicionReason(comp.reasons[0]);
    expect(loyalty.editarReason).toHaveBeenCalledWith(1, { nombre: 'Bono', signoPermitido: 'POSITIVO', porcentaje: 20 });
    expect(comp.reasons[0].porcentaje).toBe(20);
  });

  it('guardarEdicionReason(): rechaza porcentaje + signoPermitido AMBOS sin llamar al servicio', () => {
    comp.ngOnInit();
    comp.iniciarEdicionReason(comp.reasons[0]);
    comp.editReason.signoPermitido = 'AMBOS';
    comp.editReason.porcentaje = 20;
    comp.guardarEdicionReason(comp.reasons[0]);
    expect(loyalty.editarReason).not.toHaveBeenCalled();
    expect(comp.reasonsError).toContain('AMBOS');
  });

  it('iniciarEdicionReason(): inicializa editReason.porcentaje con el valor actual del motivo', () => {
    const conPorcentaje: LoyaltyAdjustmentReason = { id: 9, clave: 'x', nombre: 'X', signoPermitido: 'POSITIVO', activo: true, porcentaje: 7 };
    comp.ngOnInit();
    comp.iniciarEdicionReason(conPorcentaje);
    expect(comp.editReason.porcentaje).toBe(7);
  });

  // ── Promociones (feature nueva) ───────────────────────────────────────────

  it('ngOnInit(): also loads promociones', () => {
    comp.ngOnInit();
    expect(comp.promociones.length).toBe(1);
    expect(comp.promociones[0].nombre).toBe('Buen Fin');
  });

  it('cargarPromociones(): surfaces the backend error message on failure', () => {
    loyalty.listarPromociones.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
    comp.ngOnInit();
    expect(comp.promocionesError).toBe('No autorizado');
  });

  it('crearPromocion(): requires nombre, fechas and a valid porcentajeBono before calling the service', () => {
    comp.ngOnInit();
    comp.nuevaPromocion = { nombre: '', fechaInicio: '', fechaFin: '', porcentajeBono: null };
    comp.crearPromocion();
    expect(loyalty.crearPromocion).not.toHaveBeenCalled();
    expect(comp.promocionesError).toBeTruthy();
  });

  it('crearPromocion(): rejects fechaFin before fechaInicio', () => {
    comp.ngOnInit();
    comp.nuevaPromocion = { nombre: 'Buen Fin', fechaInicio: '2026-11-18', fechaFin: '2026-11-15', porcentajeBono: 5 };
    comp.crearPromocion();
    expect(loyalty.crearPromocion).not.toHaveBeenCalled();
    expect(comp.promocionesError).toContain('fecha');
  });

  it('crearPromocion(): rejects an out-of-range porcentajeBono', () => {
    comp.ngOnInit();
    comp.nuevaPromocion = { nombre: 'Buen Fin', fechaInicio: '2026-11-15', fechaFin: '2026-11-18', porcentajeBono: 150 };
    comp.crearPromocion();
    expect(loyalty.crearPromocion).not.toHaveBeenCalled();
  });

  it('crearPromocion(): on success appends the new promotion and closes the form', () => {
    const nueva: LoyaltyPromotion = { id: 2, nombre: 'Navidad', fechaInicio: '2026-12-01', fechaFin: '2026-12-25', porcentajeBono: 8, activa: true };
    loyalty.crearPromocion.and.returnValue(of(nueva));
    comp.ngOnInit();
    comp.showNuevaPromocion = true;
    comp.nuevaPromocion = { nombre: 'Navidad', fechaInicio: '2026-12-01', fechaFin: '2026-12-25', porcentajeBono: 8 };
    comp.crearPromocion();
    expect(loyalty.crearPromocion).toHaveBeenCalledWith({ nombre: 'Navidad', fechaInicio: '2026-12-01', fechaFin: '2026-12-25', porcentajeBono: 8 });
    expect(comp.promociones).toContain(nueva);
    expect(comp.showNuevaPromocion).toBe(false);
  });

  it('iniciarEdicionPromocion(): loads the promotion fields into editPromocion', () => {
    comp.ngOnInit();
    comp.iniciarEdicionPromocion(comp.promociones[0]);
    expect(comp.editingPromocionId).toBe(1);
    expect(comp.editPromocion).toEqual({ nombre: 'Buen Fin', fechaInicio: '2026-11-15', fechaFin: '2026-11-18', porcentajeBono: 5 });
  });

  it('guardarEdicionPromocion(): validates like crearPromocion() before calling the service', () => {
    comp.ngOnInit();
    comp.iniciarEdicionPromocion(comp.promociones[0]);
    comp.editPromocion.porcentajeBono = 0;
    comp.guardarEdicionPromocion(comp.promociones[0]);
    expect(loyalty.editarPromocion).not.toHaveBeenCalled();
    expect(comp.promocionesError).toBeTruthy();
  });

  it('guardarEdicionPromocion(): on success updates the row and exits edit mode', () => {
    const actualizada: LoyaltyPromotion = { ...PROMOCIONES[0], porcentajeBono: 12 };
    loyalty.editarPromocion.and.returnValue(of(actualizada));
    comp.ngOnInit();
    comp.iniciarEdicionPromocion(comp.promociones[0]);
    comp.editPromocion.porcentajeBono = 12;
    comp.guardarEdicionPromocion(comp.promociones[0]);
    expect(loyalty.editarPromocion).toHaveBeenCalledWith(1, { nombre: 'Buen Fin', fechaInicio: '2026-11-15', fechaFin: '2026-11-18', porcentajeBono: 12 });
    expect(comp.promociones[0].porcentajeBono).toBe(12);
    expect(comp.editingPromocionId).toBeNull();
  });

  it('toggleActivaPromocion(): flips activa via editarPromocion (PATCH solo ese campo) and replaces the row in place', () => {
    const actualizada: LoyaltyPromotion = { ...PROMOCIONES[0], activa: false };
    loyalty.editarPromocion.and.returnValue(of(actualizada));
    comp.ngOnInit();
    comp.toggleActivaPromocion(comp.promociones[0]);
    expect(loyalty.editarPromocion).toHaveBeenCalledWith(1, { activa: false });
    expect(comp.promociones[0].activa).toBe(false);
  });

  it('toggleActivaPromocion(): surfaces the backend error message on failure', () => {
    loyalty.editarPromocion.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
    comp.ngOnInit();
    comp.toggleActivaPromocion(comp.promociones[0]);
    expect(comp.promocionesError).toBe('No autorizado');
  });

  it('cancelarNuevaPromocion()/abrirNuevaPromocion(): toggle del form, reseteando nuevaPromocion', () => {
    comp.ngOnInit();
    comp.abrirNuevaPromocion();
    expect(comp.showNuevaPromocion).toBe(true);
    comp.cancelarNuevaPromocion();
    expect(comp.showNuevaPromocion).toBe(false);
  });

  it('cancelarEdicionPromocion(): exits edit mode without saving', () => {
    comp.ngOnInit();
    comp.iniciarEdicionPromocion(comp.promociones[0]);
    comp.cancelarEdicionPromocion();
    expect(comp.editingPromocionId).toBeNull();
    expect(loyalty.editarPromocion).not.toHaveBeenCalled();
  });
});
