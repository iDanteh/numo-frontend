import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError, Subject } from 'rxjs';
import { LealtadConfigComponent } from './lealtad-config.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { SocketService } from '../../../core/services/socket.service';
import { LoyaltyPorcentajes, LoyaltyAdjustmentReason, LoyaltySucursal } from '../../../core/models/loyalty.model';

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
  { id: 1, clave: 'bono', nombre: 'Bono', signoPermitido: 'POSITIVO', activo: true },
  { id: 2, clave: 'viejo', nombre: 'Motivo viejo', signoPermitido: 'AMBOS', activo: false },
];
const SUCURSALES: LoyaltySucursal[] = [
  { id: 1, clave: 'MTY', sucursal: 'Monterrey', participaLealtad: true, permiteCanjeLealtad: true },
];

function crearServicioSpy(): jasmine.SpyObj<LoyaltyService> {
  const svc = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
    'obtenerPorcentajes', 'guardarPorcentajes',
    'listarReasons', 'crearReason', 'editarReason',
    'listarSucursales', 'actualizarSucursal',
  ]);
  svc.obtenerPorcentajes.and.returnValue(of({ ...PORCENTAJES }));
  svc.listarReasons.and.returnValue(of(REASONS.map(r => ({ ...r }))));
  svc.listarSucursales.and.returnValue(of(SUCURSALES.map(s => ({ ...s }))));
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

  it('renders current tier percentages, the reasons catalog (incl. inactive) and sucursales', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Bono');
    expect(text).toContain('Motivo viejo');
    expect(text).toContain('Monterrey');
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
    comp.nuevoReason = { clave: '', nombre: '', signoPermitido: 'AMBOS' };
    comp.crearReason();
    expect(loyalty.crearReason).not.toHaveBeenCalled();
    expect(comp.reasonsError).toBeTruthy();
  });

  it('crearReason(): on success appends the new reason and closes the form', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 3, clave: 'descuento', nombre: 'Descuento', signoPermitido: 'NEGATIVO', activo: true };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.showNuevoReason = true;
    comp.nuevoReason = { clave: 'descuento', nombre: 'Descuento', signoPermitido: 'NEGATIVO' };
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
});
