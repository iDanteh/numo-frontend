import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError, Subject } from 'rxjs';
import { LealtadConfigComponent } from './lealtad-config.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { SocketService } from '../../../core/services/socket.service';
import {
  LoyaltyPorcentajes, LoyaltyAdjustmentReason, LoyaltySucursal, LoyaltyPromotion,
  LoyaltyKoreConcepto, LoyaltyKoreFormaPago,
} from '../../../core/models/loyalty.model';

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
  { id: 1, clave: 'bono', nombre: 'Bono', activo: true, puntosFijos: null },
  { id: 2, clave: 'viejo', nombre: 'Motivo viejo', activo: false, puntosFijos: null },
];
const SUCURSALES: LoyaltySucursal[] = [
  { id: 1, clave: 'MTY', sucursal: 'Monterrey', participaLealtad: true, permiteCanjeLealtad: true, serieFacturacion: null },
];
const PROMOCIONES: LoyaltyPromotion[] = [
  { id: 1, nombre: 'Buen Fin', fechaInicio: '2026-11-15', fechaFin: '2026-11-18', porcentajeBono: 5, activa: true },
];
const CONCEPTOS_KORE: LoyaltyKoreConcepto[] = [
  { id: 1, koreId: 'k1', nombre: 'COBRO TICKET SENCILLO', abreviatura: 'CBT', tipo: 'ENTRADA', acumulaPuntos: true, activo: true },
  { id: 2, koreId: 'k2', nombre: 'CIERRE CAJA', abreviatura: 'CIC', tipo: 'SALIDA', acumulaPuntos: false, activo: true },
];
const FORMAS_PAGO_KORE: LoyaltyKoreFormaPago[] = [
  { id: 1, koreId: 'f1', nombre: 'EFECTIVO', acumulaPuntos: true, esPuntos: false, koreAcumulaPuntosHint: true, koreEsPuntosHint: false, activo: true },
  { id: 2, koreId: 'f2', nombre: 'PUNTOS', acumulaPuntos: false, esPuntos: true, koreAcumulaPuntosHint: false, koreEsPuntosHint: true, activo: true },
];

function crearServicioSpy(): jasmine.SpyObj<LoyaltyService> {
  const svc = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
    'obtenerPorcentajes', 'guardarPorcentajes',
    'obtenerEspecialidades', 'guardarEspecialidades',
    'obtenerFotoFolderId', 'guardarFotoFolderId',
    'listarReasons', 'crearReason', 'editarReason',
    'listarSucursales', 'actualizarSucursal',
    'listarPromociones', 'crearPromocion', 'editarPromocion',
    'listarConceptosKore', 'sincronizarConceptosKore', 'actualizarConceptoKore',
    'listarFormasPagoKore', 'sincronizarFormasPagoKore', 'actualizarFormaPagoKore',
    'obtenerHistorialConfig',
  ]);
  svc.obtenerHistorialConfig.and.returnValue(of([]));
  svc.obtenerPorcentajes.and.returnValue(of({ ...PORCENTAJES }));
  svc.obtenerEspecialidades.and.returnValue(of(['Comercial', 'Industrial']));
  svc.obtenerFotoFolderId.and.returnValue(of({ folderId: '' }));
  svc.listarReasons.and.returnValue(of(REASONS.map(r => ({ ...r }))));
  svc.listarSucursales.and.returnValue(of(SUCURSALES.map(s => ({ ...s }))));
  svc.listarPromociones.and.returnValue(of(PROMOCIONES.map(p => ({ ...p }))));
  svc.listarConceptosKore.and.returnValue(of(CONCEPTOS_KORE.map(c => ({ ...c }))));
  svc.listarFormasPagoKore.and.returnValue(of(FORMAS_PAGO_KORE.map(f => ({ ...f }))));
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

  it('renders the Kore conceptos/formas de pago catalogs, including the hint badges', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('COBRO TICKET SENCILLO');
    expect(text).toContain('EFECTIVO');
    expect(text).toContain('Es "Puntos"');
  });

  // Foto de clientes (2026-10-29, nuevo) — Folder ID de Drive para drive-loyalty-foto.service.js.
  describe('Foto de clientes (FOTO_CLIENTE_FOLDER_ID)', () => {
    it('precarga el formulario con el valor actual (el input se renderiza visible, sin loading)', () => {
      loyalty.obtenerFotoFolderId.and.returnValue(of({ folderId: 'abc123' }));
      fixture.detectChanges();

      // Nota: esta suite usa NO_ERRORS_SCHEMA sin un <form> envolvente — leer el valor que
      // Angular escribió en el DOM vía [(ngModel)] no es confiable acá (mismo motivo por el que
      // el resto de esta suite nunca lee pct-bronce/pct-plata.value, solo el componente). La
      // precarga real del modelo (comp.fotoFolderId) ya se cubre en el describe de "lógica
      // directa" de abajo — acá solo se confirma que el campo se renderiza (sin el loading).
      expect(fixture.componentInstance.fotoFolderId).toBe('abc123');
      const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="foto-folder-id-input"]');
      expect(input).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.lc-loading')).toBeFalsy();
    });

    it('editar el input y hacer click en "Guardar" llama a guardarFotoFolderId con el valor recortado', () => {
      fixture.detectChanges();
      loyalty.guardarFotoFolderId.and.returnValue(of({ folderId: 'nuevo-id' }));
      const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="foto-folder-id-input"]');
      input.value = '  nuevo-id  ';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="foto-folder-id-guardar"]');
      btn.click();

      expect(loyalty.guardarFotoFolderId).toHaveBeenCalledWith('nuevo-id');
    });
  });

  // Historial de configuración (2026-10-29) — botón "Ver historial" en cada uno de los 3 bloques
  // de valores simples (% por nivel, Especialidades, Foto de clientes). El audit log ya existe
  // en el backend (ConfigAuditLog); esto solo cubre que el botón llama a la clave correcta y que
  // el panel se muestra con los datos mockeados.
  describe('Historial de configuración', () => {
    const LOG_BRONCE = {
      id: 1, configId: 10, usuarioId: '1', usuarioNombre: 'Admin', accion: 'editado' as const,
      valorAnterior: '1', valorNuevo: '2', fecha: '2026-10-20T10:00:00.000Z',
    };
    const LOG_ORO = {
      id: 2, configId: 11, usuarioId: '1', usuarioNombre: 'Admin', accion: 'creado' as const,
      valorAnterior: null, valorNuevo: '5', fecha: '2026-10-25T10:00:00.000Z',
    };

    it('botón de % por nivel: pide el historial de las 3 claves y muestra la fila más reciente primero', () => {
      loyalty.obtenerHistorialConfig.and.callFake((clave: string) => {
        if (clave === 'PORCENTAJE_BRONCE') return of([LOG_BRONCE]);
        if (clave === 'PORCENTAJE_ORO') return of([LOG_ORO]);
        return of([]);
      });
      fixture.detectChanges();
      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="pct-historial"]');
      btn.click();
      fixture.detectChanges();

      expect(loyalty.obtenerHistorialConfig).toHaveBeenCalledWith('PORCENTAJE_BRONCE');
      expect(loyalty.obtenerHistorialConfig).toHaveBeenCalledWith('PORCENTAJE_PLATA');
      expect(loyalty.obtenerHistorialConfig).toHaveBeenCalledWith('PORCENTAJE_ORO');

      expect(fixture.nativeElement.querySelector('.lc-history-panel')).toBeTruthy();
      const rows: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.lc-audit-row'));
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('Oro'); // 2026-10-25, más reciente que Bronce (2026-10-20)
    });

    it('botón de Especialidades llama al historial con la clave ESPECIALIDADES', () => {
      fixture.detectChanges();
      fixture.nativeElement.querySelector('[data-testid="especialidades-historial"]').click();
      expect(loyalty.obtenerHistorialConfig).toHaveBeenCalledWith('ESPECIALIDADES');
    });

    it('botón de Foto de clientes llama al historial con la clave FOTO_CLIENTE_FOLDER_ID', () => {
      fixture.detectChanges();
      fixture.nativeElement.querySelector('[data-testid="foto-folder-id-historial"]').click();
      expect(loyalty.obtenerHistorialConfig).toHaveBeenCalledWith('FOTO_CLIENTE_FOLDER_ID');
    });

    it('cerrar el panel lo quita del DOM', () => {
      fixture.detectChanges();
      fixture.nativeElement.querySelector('[data-testid="especialidades-historial"]').click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.lc-history-panel')).toBeTruthy();

      fixture.nativeElement.querySelector('.lc-icon-btn').click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.lc-history-panel')).toBeFalsy();
    });
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

  // Foto de clientes (2026-10-29, nuevo) — Folder ID de Drive para drive-loyalty-foto.service.js.
  describe('Foto de clientes (FOTO_CLIENTE_FOLDER_ID)', () => {
    it('ngOnInit(): carga el folderId actual', () => {
      loyalty.obtenerFotoFolderId.and.returnValue(of({ folderId: 'abc123' }));
      comp.ngOnInit();
      expect(comp.fotoFolderId).toBe('abc123');
      expect(comp.fotoFolderIdLoading).toBe(false);
    });

    it('ngOnInit(): error al cargar expone un mensaje', () => {
      loyalty.obtenerFotoFolderId.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
      comp.ngOnInit();
      expect(comp.fotoFolderIdError).toBe('No autorizado');
      expect(comp.fotoFolderIdLoading).toBe(false);
    });

    it('guardarFotoFolderId(): recorta espacios antes de llamar al servicio', () => {
      loyalty.guardarFotoFolderId.and.returnValue(of({ folderId: 'nuevo-id' }));
      comp.ngOnInit();
      comp.fotoFolderId = '  nuevo-id  ';
      comp.guardarFotoFolderId();
      expect(loyalty.guardarFotoFolderId).toHaveBeenCalledWith('nuevo-id');
      expect(comp.fotoFolderId).toBe('nuevo-id');
      expect(comp.fotoFolderIdSaving).toBe(false);
    });

    it('guardarFotoFolderId(): acepta guardar vacío ("no configurado")', () => {
      loyalty.guardarFotoFolderId.and.returnValue(of({ folderId: '' }));
      comp.ngOnInit();
      comp.fotoFolderId = '   ';
      comp.guardarFotoFolderId();
      expect(loyalty.guardarFotoFolderId).toHaveBeenCalledWith('');
    });

    it('guardarFotoFolderId(): surfaces the backend error message on failure', () => {
      loyalty.guardarFotoFolderId.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
      comp.ngOnInit();
      comp.guardarFotoFolderId();
      expect(comp.fotoFolderIdError).toBe('No autorizado');
      expect(comp.fotoFolderIdSaving).toBe(false);
    });
  });

  it('crearReason(): requires clave and nombre before calling the service', () => {
    comp.ngOnInit();
    comp.nuevoReason = { clave: '', nombre: '', puntosFijos: null };
    comp.crearReason();
    expect(loyalty.crearReason).not.toHaveBeenCalled();
    expect(comp.reasonsError).toBeTruthy();
  });

  it('crearReason(): on success appends the new reason and closes the form', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 3, clave: 'descuento', nombre: 'Descuento', activo: true, puntosFijos: null };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.showNuevoReason = true;
    comp.nuevoReason = { clave: 'descuento', nombre: 'Descuento', puntosFijos: null };
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

  // ── Motivos con puntosFijos (rediseño 2026-10-23) ──────────────────────────

  it('crearReason(): incluye puntosFijos (null por default) en el payload enviado', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 3, clave: 'descuento', nombre: 'Descuento', activo: true, puntosFijos: null };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.nuevoReason = { clave: 'descuento', nombre: 'Descuento', puntosFijos: null };
    comp.crearReason();
    expect(loyalty.crearReason).toHaveBeenCalledWith({ clave: 'descuento', nombre: 'Descuento', puntosFijos: null });
  });

  it('crearReason(): con puntosFijos configurado lo incluye en el payload (ej. "Bono" = 100)', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 3, clave: 'bono', nombre: 'Bono', activo: true, puntosFijos: 100 };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.nuevoReason = { clave: 'bono', nombre: 'Bono', puntosFijos: 100 };
    comp.crearReason();
    expect(loyalty.crearReason).toHaveBeenCalledWith({ clave: 'bono', nombre: 'Bono', puntosFijos: 100 });
  });

  it('crearReason(): acepta puntosFijos negativo (ej. "Comisión por mora" = -200)', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 4, clave: 'mora', nombre: 'Comisión por mora', activo: true, puntosFijos: -200 };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.nuevoReason = { clave: 'mora', nombre: 'Comisión por mora', puntosFijos: -200 };
    comp.crearReason();
    expect(loyalty.crearReason).toHaveBeenCalledWith({ clave: 'mora', nombre: 'Comisión por mora', puntosFijos: -200 });
  });

  it('crearReason(): rechaza puntosFijos en 0 sin llamar al servicio (mismo mensaje que el backend)', () => {
    comp.ngOnInit();
    comp.nuevoReason = { clave: 'promo', nombre: 'Promo', puntosFijos: 0 };
    comp.crearReason();
    expect(loyalty.crearReason).not.toHaveBeenCalled();
    expect(comp.reasonsError).toContain('entero distinto de 0');
  });

  it('guardarEdicionReason(): incluye puntosFijos en el payload', () => {
    const actualizado: LoyaltyAdjustmentReason = { ...REASONS[0], puntosFijos: 20 };
    loyalty.editarReason.and.returnValue(of(actualizado));
    comp.ngOnInit();
    comp.iniciarEdicionReason(comp.reasons[0]);
    comp.editReason.puntosFijos = 20;
    comp.guardarEdicionReason(comp.reasons[0]);
    expect(loyalty.editarReason).toHaveBeenCalledWith(1, { nombre: 'Bono', puntosFijos: 20 });
    expect(comp.reasons[0].puntosFijos).toBe(20);
  });

  it('guardarEdicionReason(): rechaza puntosFijos en 0 sin llamar al servicio', () => {
    comp.ngOnInit();
    comp.iniciarEdicionReason(comp.reasons[0]);
    comp.editReason.puntosFijos = 0;
    comp.guardarEdicionReason(comp.reasons[0]);
    expect(loyalty.editarReason).not.toHaveBeenCalled();
    expect(comp.reasonsError).toContain('entero distinto de 0');
  });

  it('iniciarEdicionReason(): inicializa editReason.puntosFijos con el valor actual del motivo', () => {
    const conPuntosFijos: LoyaltyAdjustmentReason = { id: 9, clave: 'x', nombre: 'X', activo: true, puntosFijos: 7 };
    comp.ngOnInit();
    comp.iniciarEdicionReason(conPuntosFijos);
    expect(comp.editReason.puntosFijos).toBe(7);
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

  // ── Catálogos Kore configurables (2026-10-26) ───────────────────────────

  it('ngOnInit(): also loads conceptos and formas de pago de Kore', () => {
    comp.ngOnInit();
    expect(comp.conceptosKore.length).toBe(2);
    expect(comp.formasPagoKore.length).toBe(2);
  });

  it('sincronizarConceptosKore(): on success shows the summary message and reloads the full list', () => {
    loyalty.sincronizarConceptosKore.and.returnValue(of({ nuevos: 1, actualizados: 2, desactivados: 0 }));
    comp.ngOnInit();
    loyalty.listarConceptosKore.calls.reset();
    comp.sincronizarConceptosKore();
    expect(comp.conceptosKoreSyncMensaje).toContain('1 nuevos');
    expect(loyalty.listarConceptosKore).toHaveBeenCalledTimes(1);
  });

  it('sincronizarConceptosKore(): surfaces the backend error message on failure', () => {
    loyalty.sincronizarConceptosKore.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
    comp.ngOnInit();
    comp.sincronizarConceptosKore();
    expect(comp.conceptosKoreError).toBe('No autorizado');
  });

  it('toggleAcumulaConcepto(): PATCH con acumulaPuntos invertido y reemplaza la fila', () => {
    const actualizado: LoyaltyKoreConcepto = { ...CONCEPTOS_KORE[0], acumulaPuntos: false };
    loyalty.actualizarConceptoKore.and.returnValue(of(actualizado));
    comp.ngOnInit();
    comp.toggleAcumulaConcepto(comp.conceptosKore[0]);
    expect(loyalty.actualizarConceptoKore).toHaveBeenCalledWith(1, false);
    expect(comp.conceptosKore[0].acumulaPuntos).toBe(false);
  });

  it('sincronizarFormasPagoKore(): on success shows the summary message and reloads the full list', () => {
    loyalty.sincronizarFormasPagoKore.and.returnValue(of({ nuevos: 0, actualizados: 1, desactivados: 1 }));
    comp.ngOnInit();
    loyalty.listarFormasPagoKore.calls.reset();
    comp.sincronizarFormasPagoKore();
    expect(comp.formasPagoKoreSyncMensaje).toContain('1 desactivados');
    expect(loyalty.listarFormasPagoKore).toHaveBeenCalledTimes(1);
  });

  it('toggleAcumulaFormaPago(): PATCH solo con acumulaPuntos invertido', () => {
    const actualizada: LoyaltyKoreFormaPago = { ...FORMAS_PAGO_KORE[0], acumulaPuntos: false };
    loyalty.actualizarFormaPagoKore.and.returnValue(of(actualizada));
    comp.ngOnInit();
    comp.toggleAcumulaFormaPago(comp.formasPagoKore[0]);
    expect(loyalty.actualizarFormaPagoKore).toHaveBeenCalledWith(1, { acumulaPuntos: false });
    expect(comp.formasPagoKore[0].acumulaPuntos).toBe(false);
  });

  it('marcarComoPuntos(): pide confirmación; si se cancela, no llama al servicio', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    comp.ngOnInit();
    comp.marcarComoPuntos(comp.formasPagoKore[0]);
    expect(loyalty.actualizarFormaPagoKore).not.toHaveBeenCalled();
  });

  it('marcarComoPuntos(): confirmado, hace PATCH {esPuntos:true} y recarga la lista COMPLETA (otra fila pudo cambiar)', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    loyalty.actualizarFormaPagoKore.and.returnValue(of({ ...FORMAS_PAGO_KORE[0], esPuntos: true }));
    comp.ngOnInit();
    loyalty.listarFormasPagoKore.calls.reset();
    comp.marcarComoPuntos(comp.formasPagoKore[0]);
    expect(loyalty.actualizarFormaPagoKore).toHaveBeenCalledWith(1, { esPuntos: true });
    expect(loyalty.listarFormasPagoKore).toHaveBeenCalledTimes(1);
  });

  it('marcarComoPuntos(): no hace nada si la fila ya es "Puntos" (sin confirm ni PATCH)', () => {
    spyOn(window, 'confirm');
    comp.ngOnInit();
    comp.marcarComoPuntos(comp.formasPagoKore[1]); // FORMAS_PAGO_KORE[1].esPuntos === true
    expect(window.confirm).not.toHaveBeenCalled();
    expect(loyalty.actualizarFormaPagoKore).not.toHaveBeenCalled();
  });

  // ── Historial de configuración (2026-10-29) ─────────────────────────────

  it('abrirHistorialClave(): carga el historial de la clave pedida en historyModal', () => {
    const logs = [{
      id: 1, configId: 5, usuarioId: '1', usuarioNombre: 'Admin', accion: 'editado' as const,
      valorAnterior: 'a', valorNuevo: 'b', fecha: '2026-10-20T00:00:00.000Z',
    }];
    loyalty.obtenerHistorialConfig.and.returnValue(of(logs));

    comp.abrirHistorialClave('ESPECIALIDADES', 'Especialidades');

    expect(loyalty.obtenerHistorialConfig).toHaveBeenCalledWith('ESPECIALIDADES');
    expect(comp.historyModal.titulo).toBe('Especialidades');
    expect(comp.historyModal.logs).toEqual(logs);
    expect(comp.historyModal.loading).toBe(false);
    expect(comp.historyModal.show).toBe(true);
  });

  it('abrirHistorialClave(): surfaces the backend error message on failure', () => {
    loyalty.obtenerHistorialConfig.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));

    comp.abrirHistorialClave('FOTO_CLIENTE_FOLDER_ID', 'Foto de clientes');

    expect(comp.historyModal.error).toBe('No autorizado');
    expect(comp.historyModal.loading).toBe(false);
  });

  it('abrirHistorialPorcentajes(): combina las 3 claves (Bronce/Plata/Oro), etiqueta cada fila con su nivel y ordena por fecha descendente', () => {
    loyalty.obtenerHistorialConfig.and.callFake((clave: string) => {
      if (clave === 'PORCENTAJE_BRONCE') {
        return of([{
          id: 1, configId: 1, usuarioId: null, usuarioNombre: null, accion: 'editado' as const,
          valorAnterior: '1', valorNuevo: '2', fecha: '2026-10-20T00:00:00.000Z',
        }]);
      }
      if (clave === 'PORCENTAJE_ORO') {
        return of([{
          id: 2, configId: 2, usuarioId: null, usuarioNombre: null, accion: 'creado' as const,
          valorAnterior: null, valorNuevo: '5', fecha: '2026-10-25T00:00:00.000Z',
        }]);
      }
      return of([]);
    });

    comp.abrirHistorialPorcentajes();

    expect(loyalty.obtenerHistorialConfig).toHaveBeenCalledWith('PORCENTAJE_BRONCE');
    expect(loyalty.obtenerHistorialConfig).toHaveBeenCalledWith('PORCENTAJE_PLATA');
    expect(loyalty.obtenerHistorialConfig).toHaveBeenCalledWith('PORCENTAJE_ORO');
    expect(comp.historyModal.logs.length).toBe(2);
    expect(comp.historyModal.logs[0].claveLabel).toBe('Oro'); // 2026-10-25, más reciente primero
    expect(comp.historyModal.logs[1].claveLabel).toBe('Bronce');
  });

  it('cerrarHistorial(): resetea historyModal al estado vacío', () => {
    loyalty.obtenerHistorialConfig.and.returnValue(of([{
      id: 1, configId: 1, usuarioId: null, usuarioNombre: null, accion: 'editado' as const,
      valorAnterior: 'a', valorNuevo: 'b', fecha: '2026-10-20T00:00:00.000Z',
    }]));
    comp.abrirHistorialClave('ESPECIALIDADES', 'Especialidades');

    comp.cerrarHistorial();

    expect(comp.historyModal.show).toBe(false);
    expect(comp.historyModal.logs).toEqual([]);
  });
});
