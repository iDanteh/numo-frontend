import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError, Subject } from 'rxjs';
import { LealtadConfigComponent } from './lealtad-config.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { SocketService } from '../../../core/services/socket.service';
import {
  LoyaltyAdjustmentReason, LoyaltySucursal, LoyaltyPromotion,
  LoyaltyKoreConcepto, LoyaltyKoreFormaPago, LoyaltyKoreNivel,
} from '../../../core/models/loyalty.model';

/**
 * RED (PR7, Phase 7 task 7.1-7.2) — reemplaza el placeholder de PR5. Cubre
 * spec loyalty-config: Niveles Kore (2026-11-06, reemplaza "% por nivel" —
 * catálogo de solo lectura espejado de Kore, Numo solo marca esInicial),
 * catálogo de motivos CRUD (activo/inactivo independiente de histórico),
 * flags de sucursal independientes, refresco en vivo por configUpdated$
 * filtrado a sectionClave==='lealtad' (mismo criterio que
 * movimiento-modal.component.ts / bank-corte-panel.component.ts).
 */
const NIVELES_KORE: LoyaltyKoreNivel[] = [
  { id: 1, koreId: 'n1', nombre: 'Bronce', porcentaje: 1, esInicial: true, activo: true },
  { id: 2, koreId: null, nombre: 'Plata', porcentaje: null, esInicial: false, activo: true },
];
// Split de catálogo (2026-11-03): REASONS[0] es 'bonificacion' (sección "Catálogo de
// bonificaciones"), REASONS[1] es 'ajuste' (sección "Motivos de ajuste") — a propósito distintas,
// para que las pruebas de cada sección (motivosAjuste/catalogoBonificaciones) usen la fila correcta.
const REASONS: LoyaltyAdjustmentReason[] = [
  { id: 1, clave: 'bono', nombre: 'Bono', activo: true, puntosFijos: null, categoria: 'bonificacion' },
  { id: 2, clave: 'viejo', nombre: 'Motivo viejo', activo: false, puntosFijos: null, categoria: 'ajuste' },
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
    'obtenerEspecialidades', 'guardarEspecialidades',
    'obtenerFotoFolderId', 'guardarFotoFolderId',
    'obtenerCongelamiento', 'guardarCongelamiento',
    'obtenerConsultaCodigoMaxMes', 'guardarConsultaCodigoMaxMes',
    'listarReasons', 'crearReason', 'editarReason',
    'listarSucursales', 'actualizarSucursal',
    'listarPromociones', 'crearPromocion', 'editarPromocion',
    'listarConceptosKore', 'sincronizarConceptosKore', 'actualizarConceptoKore',
    'listarFormasPagoKore', 'sincronizarFormasPagoKore', 'actualizarFormaPagoKore',
    'listarNivelesKore', 'sincronizarNivelesKore', 'actualizarNivelKore',
    'obtenerHistorialConfig',
  ]);
  svc.obtenerHistorialConfig.and.returnValue(of([]));
  svc.obtenerEspecialidades.and.returnValue(of(['Comercial', 'Industrial']));
  svc.obtenerFotoFolderId.and.returnValue(of({ folderId: '' }));
  svc.obtenerCongelamiento.and.returnValue(of({ meses: null }));
  svc.obtenerConsultaCodigoMaxMes.and.returnValue(of({ max: null }));
  // Split de catálogo (2026-11-03): el componente llama listarReasons({categoria}) dos veces (una
  // por sección) — el fake filtra REASONS por esa categoria, igual que haría el backend real.
  svc.listarReasons.and.callFake((filtro?: any) =>
    of(REASONS.filter(r => !filtro?.categoria || r.categoria === filtro.categoria).map(r => ({ ...r }))));
  svc.listarSucursales.and.returnValue(of(SUCURSALES.map(s => ({ ...s }))));
  svc.listarPromociones.and.returnValue(of(PROMOCIONES.map(p => ({ ...p }))));
  svc.listarConceptosKore.and.returnValue(of(CONCEPTOS_KORE.map(c => ({ ...c }))));
  svc.listarFormasPagoKore.and.returnValue(of(FORMAS_PAGO_KORE.map(f => ({ ...f }))));
  svc.listarNivelesKore.and.returnValue(of(NIVELES_KORE.map(n => ({ ...n }))));
  return svc;
}

function crearSocketStub(): any {
  // Notificación en vivo (2026-11-10) — `lealtadNivelesKoreActualizado$` agregado junto con
  // `configUpdated$`, mismo criterio (broadcast global, Subject real para poder simular el evento).
  return { configUpdated$: new Subject(), lealtadNivelesKoreActualizado$: new Subject() };
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

  it('renders the Kore niveles catalog, the reasons catalog (incl. inactive), sucursales and promociones', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Bronce');
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

  it('niveles-kore-sync: clicking "Sincronizar con Kore" calls sincronizarNivelesKore and reloads the list', () => {
    fixture.detectChanges();
    loyalty.sincronizarNivelesKore.and.returnValue(of({ nuevos: 1, actualizados: 1, desactivados: 0 }));
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="niveles-kore-sync"]');
    btn.click();
    expect(loyalty.sincronizarNivelesKore).toHaveBeenCalled();
    expect(loyalty.listarNivelesKore).toHaveBeenCalledTimes(2); // ngOnInit + tras sincronizar
  });

  it('nivel-marcar-inicial: clicking the button on a non-inicial row calls actualizarNivelKore(id, true)', () => {
    fixture.detectChanges();
    loyalty.actualizarNivelKore.and.returnValue(of({ ...NIVELES_KORE[1], esInicial: true }));
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="nivel-marcar-inicial-2"]');
    btn.click();
    expect(loyalty.actualizarNivelKore).toHaveBeenCalledWith(2, true);
  });

  it('toggling a sucursal checkbox calls actualizarSucursal with only that flag', () => {
    loyalty.actualizarSucursal.and.returnValue(of({ ...SUCURSALES[0], participaLealtad: false }));
    fixture.detectChanges();
    const checkbox: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="sucursal-participa-1"]');
    checkbox.dispatchEvent(new Event('change'));
    expect(loyalty.actualizarSucursal).toHaveBeenCalledWith(1, { participaLealtad: false });
  });

  it('live refresh: reloads especialidades when configUpdated$ fires for sectionClave "lealtad"', () => {
    fixture.detectChanges();
    loyalty.obtenerEspecialidades.calls.reset();
    socket.configUpdated$.next({ sectionClave: 'lealtad', clave: 'ESPECIALIDADES' });
    expect(loyalty.obtenerEspecialidades).toHaveBeenCalledTimes(1);
  });

  it('live refresh: ignores configUpdated$ for other sections', () => {
    fixture.detectChanges();
    loyalty.obtenerEspecialidades.calls.reset();
    socket.configUpdated$.next({ sectionClave: 'bancos', clave: 'CORTE_PERIODO_COBRANZA' });
    expect(loyalty.obtenerEspecialidades).not.toHaveBeenCalled();
  });

  // Notificación en vivo (2026-11-10, pedido explícito del usuario): broadcast GLOBAL del webhook
  // de catálogo de niveles de Kore — refresca la tabla "Niveles Kore".
  it('live refresh: reloads Niveles Kore when lealtadNivelesKoreActualizado$ fires', () => {
    fixture.detectChanges();
    loyalty.listarNivelesKore.calls.reset();
    socket.lealtadNivelesKoreActualizado$.next({ nivelId: 1 });
    expect(loyalty.listarNivelesKore).toHaveBeenCalledTimes(1);
  });

  it('renders the Kore conceptos/formas de pago/niveles catalogs, including the hint badges', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('COBRO TICKET SENCILLO');
    expect(text).toContain('EFECTIVO');
    expect(text).toContain('Es "Puntos"');
    expect(text).toContain('Nivel inicial');
    expect(text).toContain('Pendiente de Kore'); // Plata: koreId:null, fila transicional
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

  // Congelamiento de puntos (2026-11-03, nuevo) — meses de inactividad tras los cuales el job
  // diario resetea el saldo de una tarjeta a 0 (ver loyalty-config.service.js#guardarCongelamientoMeses).
  describe('Congelamiento de puntos (CONGELAMIENTO_MESES)', () => {
    it('precarga el formulario con el valor actual (el input se renderiza visible, sin loading)', () => {
      loyalty.obtenerCongelamiento.and.returnValue(of({ meses: 6 }));
      fixture.detectChanges();

      expect(fixture.componentInstance.congelamientoMeses).toBe(6);
      const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="congelamiento-meses"]');
      expect(input).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.lc-loading')).toBeFalsy();
    });

    it('editar el input y hacer click en "Guardar" llama a guardarCongelamiento con el valor capturado', () => {
      fixture.detectChanges();
      loyalty.guardarCongelamiento.and.returnValue(of({ meses: 12 }));
      const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="congelamiento-meses"]');
      input.value = '12';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="congelamiento-guardar"]');
      btn.click();

      expect(loyalty.guardarCongelamiento).toHaveBeenCalledWith(12);
    });
  });

  // Límite mensual de consultas con código (2026-11-09, nuevo) — blindaje adicional sobre la
  // consulta pública (ver loyalty-config.service.js#guardarConsultaCodigoMaxMes).
  describe('Límite de consultas con código (CONSULTA_CODIGO_MAX_MES)', () => {
    it('precarga el formulario con el valor actual (el input se renderiza visible, sin loading)', () => {
      loyalty.obtenerConsultaCodigoMaxMes.and.returnValue(of({ max: 1 }));
      fixture.detectChanges();

      expect(fixture.componentInstance.consultaCodigoMaxMes).toBe(1);
      const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="consulta-codigo-max-mes"]');
      expect(input).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.lc-loading')).toBeFalsy();
    });

    it('editar el input y hacer click en "Guardar" llama a guardarConsultaCodigoMaxMes con el valor capturado', () => {
      fixture.detectChanges();
      loyalty.guardarConsultaCodigoMaxMes.and.returnValue(of({ max: 2 }));
      const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="consulta-codigo-max-mes"]');
      input.value = '2';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="consulta-codigo-max-mes-guardar"]');
      btn.click();

      expect(loyalty.guardarConsultaCodigoMaxMes).toHaveBeenCalledWith(2);
    });
  });

  // Historial de configuración (2026-10-29) — botón "Ver historial" en Especialidades/Foto de
  // clientes/Congelamiento (% por nivel ya NO tiene este botón, ver Niveles Kore). El audit log ya
  // existe en el backend (ConfigAuditLog); esto solo cubre que el botón llama a la clave correcta y
  // que el panel se muestra con los datos mockeados.
  describe('Historial de configuración', () => {
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

    it('botón de Congelamiento de puntos llama al historial con la clave CONGELAMIENTO_MESES', () => {
      fixture.detectChanges();
      fixture.nativeElement.querySelector('[data-testid="congelamiento-historial"]').click();
      expect(loyalty.obtenerHistorialConfig).toHaveBeenCalledWith('CONGELAMIENTO_MESES');
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

  it('ngOnInit(): loads niveles Kore, reasons (split by categoria) and sucursales', () => {
    comp.ngOnInit();
    expect(comp.nivelesKore.length).toBe(2);
    expect(comp.nivelesKore[0].nombre).toBe('Bronce');
    expect(comp.motivosAjuste.list.length).toBe(1);
    expect(comp.motivosAjuste.list[0].clave).toBe('viejo');
    expect(comp.catalogoBonificaciones.list.length).toBe(1);
    expect(comp.catalogoBonificaciones.list[0].clave).toBe('bono');
    expect(comp.sucursales.length).toBe(1);
  });

  it('sincronizarNivelesKore(): calls the service and reloads the list on success', () => {
    loyalty.sincronizarNivelesKore.and.returnValue(of({ nuevos: 1, actualizados: 0, desactivados: 0 }));
    comp.ngOnInit();
    loyalty.listarNivelesKore.calls.reset();
    comp.sincronizarNivelesKore();
    expect(loyalty.sincronizarNivelesKore).toHaveBeenCalled();
    expect(loyalty.listarNivelesKore).toHaveBeenCalledTimes(1);
    expect(comp.nivelesKoreSyncMensaje).toContain('1 nuevos');
  });

  it('sincronizarNivelesKore(): surfaces the backend error message on failure', () => {
    loyalty.sincronizarNivelesKore.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
    comp.ngOnInit();
    comp.sincronizarNivelesKore();
    expect(comp.nivelesKoreError).toBe('No autorizado');
  });

  it('toggleEsInicial(): calls actualizarNivelKore(id, true) and reloads the list, ignores a row already marked', () => {
    loyalty.actualizarNivelKore.and.returnValue(of({ ...NIVELES_KORE[1], esInicial: true }));
    comp.ngOnInit();
    comp.toggleEsInicial(comp.nivelesKore[1]);
    expect(loyalty.actualizarNivelKore).toHaveBeenCalledWith(2, true);

    loyalty.actualizarNivelKore.calls.reset();
    comp.toggleEsInicial(comp.nivelesKore[0]); // ya es esInicial:true, no debe llamar al service
    expect(loyalty.actualizarNivelKore).not.toHaveBeenCalled();
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

  // Congelamiento de puntos (2026-11-03, nuevo) — meses de inactividad tras los cuales el job
  // diario resetea el saldo de una tarjeta a 0 (ver loyalty-config.service.js#guardarCongelamientoMeses).
  describe('Congelamiento de puntos (CONGELAMIENTO_MESES)', () => {
    it('ngOnInit(): carga los meses actuales', () => {
      loyalty.obtenerCongelamiento.and.returnValue(of({ meses: 6 }));
      comp.ngOnInit();
      expect(comp.congelamientoMeses).toBe(6);
      expect(comp.congelamientoLoading).toBe(false);
    });

    it('ngOnInit(): error al cargar expone un mensaje', () => {
      loyalty.obtenerCongelamiento.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
      comp.ngOnInit();
      expect(comp.congelamientoError).toBe('No autorizado');
      expect(comp.congelamientoLoading).toBe(false);
    });

    it('guardarCongelamiento(): llama al servicio con el valor capturado y refleja la respuesta', () => {
      loyalty.guardarCongelamiento.and.returnValue(of({ meses: 12 }));
      comp.ngOnInit();
      comp.congelamientoMeses = 12;
      comp.guardarCongelamiento();
      expect(loyalty.guardarCongelamiento).toHaveBeenCalledWith(12);
      expect(comp.congelamientoMeses).toBe(12);
      expect(comp.congelamientoSaving).toBe(false);
    });

    it('guardarCongelamiento(): acepta null para deshabilitar (mismo criterio que el backend)', () => {
      loyalty.guardarCongelamiento.and.returnValue(of({ meses: null }));
      comp.ngOnInit();
      comp.congelamientoMeses = null;
      comp.guardarCongelamiento();
      expect(loyalty.guardarCongelamiento).toHaveBeenCalledWith(null);
    });

    it('guardarCongelamiento(): acepta 0 para deshabilitar', () => {
      loyalty.guardarCongelamiento.and.returnValue(of({ meses: null }));
      comp.ngOnInit();
      comp.congelamientoMeses = 0;
      comp.guardarCongelamiento();
      expect(loyalty.guardarCongelamiento).toHaveBeenCalledWith(0);
    });

    it('guardarCongelamiento(): rechaza un valor no entero sin llamar al servicio (mismo mensaje que el backend)', () => {
      comp.ngOnInit();
      comp.congelamientoMeses = 1.5;
      comp.guardarCongelamiento();
      expect(loyalty.guardarCongelamiento).not.toHaveBeenCalled();
      expect(comp.congelamientoError).toContain('entero positivo');
    });

    it('guardarCongelamiento(): rechaza un valor negativo sin llamar al servicio', () => {
      comp.ngOnInit();
      comp.congelamientoMeses = -3;
      comp.guardarCongelamiento();
      expect(loyalty.guardarCongelamiento).not.toHaveBeenCalled();
      expect(comp.congelamientoError).toContain('entero positivo');
    });

    it('guardarCongelamiento(): surfaces the backend error message on failure', () => {
      loyalty.guardarCongelamiento.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
      comp.ngOnInit();
      comp.guardarCongelamiento();
      expect(comp.congelamientoError).toBe('No autorizado');
      expect(comp.congelamientoSaving).toBe(false);
    });
  });

  // Límite mensual de consultas con código (2026-11-09, nuevo) — blindaje adicional sobre la
  // consulta pública (ver loyalty-config.service.js#guardarConsultaCodigoMaxMes).
  describe('Límite de consultas con código (CONSULTA_CODIGO_MAX_MES)', () => {
    it('ngOnInit(): carga el máximo actual', () => {
      loyalty.obtenerConsultaCodigoMaxMes.and.returnValue(of({ max: 1 }));
      comp.ngOnInit();
      expect(comp.consultaCodigoMaxMes).toBe(1);
      expect(comp.consultaCodigoMaxMesLoading).toBe(false);
    });

    it('ngOnInit(): error al cargar expone un mensaje', () => {
      loyalty.obtenerConsultaCodigoMaxMes.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
      comp.ngOnInit();
      expect(comp.consultaCodigoMaxMesError).toBe('No autorizado');
      expect(comp.consultaCodigoMaxMesLoading).toBe(false);
    });

    it('guardarConsultaCodigoMaxMes(): llama al servicio con el valor capturado y refleja la respuesta', () => {
      loyalty.guardarConsultaCodigoMaxMes.and.returnValue(of({ max: 2 }));
      comp.ngOnInit();
      comp.consultaCodigoMaxMes = 2;
      comp.guardarConsultaCodigoMaxMes();
      expect(loyalty.guardarConsultaCodigoMaxMes).toHaveBeenCalledWith(2);
      expect(comp.consultaCodigoMaxMes).toBe(2);
      expect(comp.consultaCodigoMaxMesSaving).toBe(false);
    });

    it('guardarConsultaCodigoMaxMes(): acepta null para deshabilitar (mismo criterio que el backend)', () => {
      loyalty.guardarConsultaCodigoMaxMes.and.returnValue(of({ max: null }));
      comp.ngOnInit();
      comp.consultaCodigoMaxMes = null;
      comp.guardarConsultaCodigoMaxMes();
      expect(loyalty.guardarConsultaCodigoMaxMes).toHaveBeenCalledWith(null);
    });

    it('guardarConsultaCodigoMaxMes(): acepta 0 para deshabilitar', () => {
      loyalty.guardarConsultaCodigoMaxMes.and.returnValue(of({ max: null }));
      comp.ngOnInit();
      comp.consultaCodigoMaxMes = 0;
      comp.guardarConsultaCodigoMaxMes();
      expect(loyalty.guardarConsultaCodigoMaxMes).toHaveBeenCalledWith(0);
    });

    it('guardarConsultaCodigoMaxMes(): rechaza un valor no entero sin llamar al servicio (mismo mensaje que el backend)', () => {
      comp.ngOnInit();
      comp.consultaCodigoMaxMes = 1.5;
      comp.guardarConsultaCodigoMaxMes();
      expect(loyalty.guardarConsultaCodigoMaxMes).not.toHaveBeenCalled();
      expect(comp.consultaCodigoMaxMesError).toContain('entero positivo');
    });

    it('guardarConsultaCodigoMaxMes(): rechaza un valor negativo sin llamar al servicio', () => {
      comp.ngOnInit();
      comp.consultaCodigoMaxMes = -3;
      comp.guardarConsultaCodigoMaxMes();
      expect(loyalty.guardarConsultaCodigoMaxMes).not.toHaveBeenCalled();
      expect(comp.consultaCodigoMaxMesError).toContain('entero positivo');
    });

    it('guardarConsultaCodigoMaxMes(): surfaces the backend error message on failure', () => {
      loyalty.guardarConsultaCodigoMaxMes.and.returnValue(throwError(() => ({ error: { error: 'No autorizado' } })));
      comp.ngOnInit();
      comp.guardarConsultaCodigoMaxMes();
      expect(comp.consultaCodigoMaxMesError).toBe('No autorizado');
      expect(comp.consultaCodigoMaxMesSaving).toBe(false);
    });
  });

  // Split de catálogo (2026-11-03): la lógica CRUD vive en ReasonCatalogoSeccion, compartida por
  // ambas secciones — se ejercita a fondo vía motivosAjuste (categoria='ajuste') y se confirma
  // aparte que catalogoBonificaciones (categoria='bonificacion') manda su propia categoria fija.
  it('motivosAjuste.crear(): requires clave and nombre before calling the service', () => {
    comp.ngOnInit();
    comp.motivosAjuste.nuevo = { clave: '', nombre: '', puntosFijos: null };
    comp.motivosAjuste.crear();
    expect(loyalty.crearReason).not.toHaveBeenCalled();
    expect(comp.motivosAjuste.error).toBeTruthy();
  });

  it('motivosAjuste.crear(): on success appends the new reason, closes the form, and sends categoria="ajuste"', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 3, clave: 'descuento', nombre: 'Descuento', activo: true, puntosFijos: null, categoria: 'ajuste' };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.motivosAjuste.showNuevo = true;
    comp.motivosAjuste.nuevo = { clave: 'descuento', nombre: 'Descuento', puntosFijos: null };
    comp.motivosAjuste.crear();
    expect(loyalty.crearReason).toHaveBeenCalledWith({ clave: 'descuento', nombre: 'Descuento', puntosFijos: null, categoria: 'ajuste' });
    expect(comp.motivosAjuste.list).toContain(nuevo);
    expect(comp.motivosAjuste.showNuevo).toBe(false);
  });

  it('catalogoBonificaciones.crear(): sends categoria="bonificacion"', () => {
    const nueva: LoyaltyAdjustmentReason = { id: 4, clave: 'regalo2', nombre: 'Regalo 2', activo: true, puntosFijos: 50, categoria: 'bonificacion' };
    loyalty.crearReason.and.returnValue(of(nueva));
    comp.ngOnInit();
    comp.catalogoBonificaciones.nuevo = { clave: 'regalo2', nombre: 'Regalo 2', puntosFijos: 50 };
    comp.catalogoBonificaciones.crear();
    expect(loyalty.crearReason).toHaveBeenCalledWith({ clave: 'regalo2', nombre: 'Regalo 2', puntosFijos: 50, categoria: 'bonificacion' });
    expect(comp.catalogoBonificaciones.list).toContain(nueva);
  });

  it('motivosAjuste.toggleActivo(): flips activo via editarReason and replaces the row in place', () => {
    const actualizado: LoyaltyAdjustmentReason = { ...REASONS[1], activo: true };
    loyalty.editarReason.and.returnValue(of(actualizado));
    comp.ngOnInit();
    comp.motivosAjuste.toggleActivo(comp.motivosAjuste.list[0]);
    expect(loyalty.editarReason).toHaveBeenCalledWith(2, { activo: true });
    expect(comp.motivosAjuste.list[0].activo).toBe(true);
  });

  it('motivosAjuste.guardarEdicion(): requires a non-empty nombre', () => {
    comp.ngOnInit();
    comp.motivosAjuste.iniciarEdicion(comp.motivosAjuste.list[0]);
    comp.motivosAjuste.edit.nombre = '  ';
    comp.motivosAjuste.guardarEdicion(comp.motivosAjuste.list[0]);
    expect(loyalty.editarReason).not.toHaveBeenCalled();
  });

  it('motivosAjuste.guardarEdicion(): on success updates the row and exits edit mode', () => {
    const actualizado: LoyaltyAdjustmentReason = { ...REASONS[1], nombre: 'Corrección renombrada' };
    loyalty.editarReason.and.returnValue(of(actualizado));
    comp.ngOnInit();
    comp.motivosAjuste.iniciarEdicion(comp.motivosAjuste.list[0]);
    comp.motivosAjuste.edit.nombre = 'Corrección renombrada';
    comp.motivosAjuste.guardarEdicion(comp.motivosAjuste.list[0]);
    expect(comp.motivosAjuste.list[0].nombre).toBe('Corrección renombrada');
    expect(comp.motivosAjuste.editingId).toBeNull();
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
    loyalty.obtenerEspecialidades.calls.reset();
    socket.configUpdated$.next({ sectionClave: 'lealtad', clave: 'ESPECIALIDADES' });
    expect(loyalty.obtenerEspecialidades).not.toHaveBeenCalled();
  });

  it('ngOnDestroy(): unsubscribes from lealtadNivelesKoreActualizado$', () => {
    comp.ngOnInit();
    comp.ngOnDestroy();
    loyalty.listarNivelesKore.calls.reset();
    socket.lealtadNivelesKoreActualizado$.next({ nivelId: 1 });
    expect(loyalty.listarNivelesKore).not.toHaveBeenCalled();
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

  it('motivosAjuste.crear(): incluye puntosFijos (null por default) en el payload enviado', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 3, clave: 'descuento', nombre: 'Descuento', activo: true, puntosFijos: null, categoria: 'ajuste' };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.motivosAjuste.nuevo = { clave: 'descuento', nombre: 'Descuento', puntosFijos: null };
    comp.motivosAjuste.crear();
    expect(loyalty.crearReason).toHaveBeenCalledWith({ clave: 'descuento', nombre: 'Descuento', puntosFijos: null, categoria: 'ajuste' });
  });

  it('motivosAjuste.crear(): con puntosFijos configurado lo incluye en el payload (ej. "Bono" = 100)', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 3, clave: 'bono', nombre: 'Bono', activo: true, puntosFijos: 100, categoria: 'ajuste' };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.motivosAjuste.nuevo = { clave: 'bono', nombre: 'Bono', puntosFijos: 100 };
    comp.motivosAjuste.crear();
    expect(loyalty.crearReason).toHaveBeenCalledWith({ clave: 'bono', nombre: 'Bono', puntosFijos: 100, categoria: 'ajuste' });
  });

  it('motivosAjuste.crear(): acepta puntosFijos negativo (ej. "Comisión por mora" = -200)', () => {
    const nuevo: LoyaltyAdjustmentReason = { id: 4, clave: 'mora', nombre: 'Comisión por mora', activo: true, puntosFijos: -200, categoria: 'ajuste' };
    loyalty.crearReason.and.returnValue(of(nuevo));
    comp.ngOnInit();
    comp.motivosAjuste.nuevo = { clave: 'mora', nombre: 'Comisión por mora', puntosFijos: -200 };
    comp.motivosAjuste.crear();
    expect(loyalty.crearReason).toHaveBeenCalledWith({ clave: 'mora', nombre: 'Comisión por mora', puntosFijos: -200, categoria: 'ajuste' });
  });

  it('motivosAjuste.crear(): rechaza puntosFijos en 0 sin llamar al servicio (mismo mensaje que el backend)', () => {
    comp.ngOnInit();
    comp.motivosAjuste.nuevo = { clave: 'promo', nombre: 'Promo', puntosFijos: 0 };
    comp.motivosAjuste.crear();
    expect(loyalty.crearReason).not.toHaveBeenCalled();
    expect(comp.motivosAjuste.error).toContain('entero distinto de 0');
  });

  it('motivosAjuste.guardarEdicion(): incluye puntosFijos en el payload', () => {
    const actualizado: LoyaltyAdjustmentReason = { ...REASONS[1], puntosFijos: 20 };
    loyalty.editarReason.and.returnValue(of(actualizado));
    comp.ngOnInit();
    comp.motivosAjuste.iniciarEdicion(comp.motivosAjuste.list[0]);
    comp.motivosAjuste.edit.puntosFijos = 20;
    comp.motivosAjuste.guardarEdicion(comp.motivosAjuste.list[0]);
    expect(loyalty.editarReason).toHaveBeenCalledWith(2, { nombre: 'Motivo viejo', puntosFijos: 20 });
    expect(comp.motivosAjuste.list[0].puntosFijos).toBe(20);
  });

  it('motivosAjuste.guardarEdicion(): rechaza puntosFijos en 0 sin llamar al servicio', () => {
    comp.ngOnInit();
    comp.motivosAjuste.iniciarEdicion(comp.motivosAjuste.list[0]);
    comp.motivosAjuste.edit.puntosFijos = 0;
    comp.motivosAjuste.guardarEdicion(comp.motivosAjuste.list[0]);
    expect(loyalty.editarReason).not.toHaveBeenCalled();
    expect(comp.motivosAjuste.error).toContain('entero distinto de 0');
  });

  it('motivosAjuste.iniciarEdicion(): inicializa edit.puntosFijos con el valor actual del motivo', () => {
    const conPuntosFijos: LoyaltyAdjustmentReason = { id: 9, clave: 'x', nombre: 'X', activo: true, puntosFijos: 7, categoria: 'ajuste' };
    comp.ngOnInit();
    comp.motivosAjuste.iniciarEdicion(conPuntosFijos);
    expect(comp.motivosAjuste.edit.puntosFijos).toBe(7);
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
