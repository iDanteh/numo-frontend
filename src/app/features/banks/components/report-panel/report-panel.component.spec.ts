import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of, Subject } from 'rxjs';

import { ReportPanelComponent } from './report-panel.component';
import { BankService, BankCard } from '../../../../core/services/bank.service';
import { AuthService, AppUser } from '../../../../core/services/auth.service';
import { EntidadActivaService, EntidadActiva } from '../../../../core/services/entidad-activa.service';
import { ReportFiltrosGuardadosService } from '../../../../core/services/report-filtros-guardados.service';

// report-panel.component.spec.ts — primer spec de este componente. Cobertura
// enfocada en la feature nueva (2026-09-07, guardar filtros del panel en
// localStorage + aviso al exportar si difieren de lo guardado): no se cubre
// el resto del comportamiento previo del panel (no tenía spec). NO_ERRORS_SCHEMA
// porque el .html usa <app-confirm-modal> (SharedModule) y no hace falta
// declarar/importar ese módulo entero solo para este spec.

const BANK_CARDS: BankCard[] = [
  {
    banco: 'BBVA', movimientos: 10, movimientoNoIdentificado: 0,
    totalDepositos: 1000, totalRetiros: 500, saldoFinal: 500,
    saldoPendiente: 0, saldoActualizado: 500,
  } as BankCard,
  {
    banco: 'Santander', movimientos: 5, movimientoNoIdentificado: 0,
    totalDepositos: 200, totalRetiros: 100, saldoFinal: 100,
    saldoPendiente: 0, saldoActualizado: 100,
  } as BankCard,
];

const USER: AppUser = {
  id: 'auth0|abc123', name: 'Tester', email: 't@test.com', role: 'contabilidad',
  permissions: ['*'], picture: null, empresas: [],
};

const ENTIDAD: EntidadActiva = { rfc: 'CCO011113663', nombre: 'CAR COMERCIALIZADORA S.A. DE C.V.' };

function changesVisible() {
  return { visible: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true } };
}

describe('ReportPanelComponent — filtros guardados (localStorage, TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let filtrosService: ReportFiltrosGuardadosService;
  let component: ReportPanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<ReportPanelComponent>;

  const STORAGE_KEY = `numo_report_filtros_${USER.id}_${ENTIDAD.rfc}`;

  beforeEach(async () => {
    localStorage.removeItem(STORAGE_KEY);

    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', [
      'listCategories', 'listIdentificadores', 'exportMovements',
    ]);
    bankServiceSpy.listCategories.and.returnValue(of([]));
    bankServiceSpy.listIdentificadores.and.returnValue(of([]));
    bankServiceSpy.exportMovements.and.returnValue(of(new Blob(['x'])));

    // Mismo patrón que banks.component.spec.ts: objeto literal con `currentUser`/
    // `snapshot` fijos en vez de jasmine.createSpyObj (son getters, no métodos).
    const authSpy = { currentUser: USER };
    const entidadActivaSpy = { snapshot: ENTIDAD };

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [ReportPanelComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: EntidadActivaService, useValue: entidadActivaSpy },
        ReportFiltrosGuardadosService,
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportPanelComponent);
    component = fixture.componentInstance;
    filtrosService = TestBed.inject(ReportFiltrosGuardadosService);
    component.bankCards = BANK_CARDS;
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  function abrirPanel() {
    component.visible = true;
    component.ngOnChanges(changesVisible());
    fixture.detectChanges();
  }

  it('sin configuración guardada: al exportar aparece el aviso de "guardar", no exporta todavía', () => {
    abrirPanel();

    component.exportReport();

    expect(component.showFiltrosModal).toBe(true);
    expect(component.filtrosModalMode).toBe('guardar');
    expect(bankServiceSpy.exportMovements).not.toHaveBeenCalled();
  });

  it('el export real SIEMPRE se dispara, elija lo que elija el usuario en el modal (guardar)', () => {
    abrirPanel();
    component.exportReport();

    component.onFiltrosModalGuardar();

    expect(bankServiceSpy.exportMovements).toHaveBeenCalledTimes(1);
    expect(component.showFiltrosModal).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('el export real SIEMPRE se dispara, elija lo que elija el usuario en el modal (volver = no guardar)', () => {
    abrirPanel();
    component.exportReport();

    component.onFiltrosModalVolver();

    expect(bankServiceSpy.exportMovements).toHaveBeenCalledTimes(1);
    expect(component.showFiltrosModal).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('arma fechaImportacionInicio/Fin en el BankFilter enviado a exportMovements', () => {
    abrirPanel();
    component.fechaImportacionInicio = '2026-01-01';
    component.fechaImportacionFin    = '2026-01-31';

    component.exportReport();
    component.onFiltrosModalGuardar();

    const filtroEnviado = bankServiceSpy.exportMovements.calls.argsFor(0)[0];
    expect(filtroEnviado.fechaImportacionInicio).toBe('2026-01-01');
    expect(filtroEnviado.fechaImportacionFin).toBe('2026-01-31');
  });

  it('configuración guardada coincide con los filtros actuales: exporta directo, sin modal', () => {
    abrirPanel();
    // Guarda la config tal como quedó tras abrir el panel (defaults de fábrica).
    filtrosService.guardar(USER.id, ENTIDAD.rfc, {
      bancos: component.reportBancos,
      statuses: component.reportStatuses,
      tipos: component.reportTipos,
      categorias: component.reportCategorias,
      identificadoPor: component.reportIdentificadoPor,
      columnas: component.reportColumnas,
      importeMin: component.importeMin,
      importeMax: component.importeMax,
      folioFilter: component.folioFilter,
      fichaFilter: component.fichaFilter,
    });

    component.exportReport();

    expect(component.showFiltrosModal).toBe(false);
    expect(bankServiceSpy.exportMovements).toHaveBeenCalledTimes(1);
  });

  it('configuración guardada DIFIERE de los filtros actuales: aparece el aviso de "actualizar"', () => {
    abrirPanel();
    filtrosService.guardar(USER.id, ENTIDAD.rfc, {
      bancos: component.reportBancos,
      statuses: component.reportStatuses,
      tipos: component.reportTipos,
      categorias: component.reportCategorias,
      identificadoPor: component.reportIdentificadoPor,
      columnas: component.reportColumnas,
      importeMin: component.importeMin,
      importeMax: component.importeMax,
      folioFilter: component.folioFilter,
      fichaFilter: component.fichaFilter,
    });

    // El usuario cambia el rango de importe respecto a lo guardado.
    component.importeMin = 500;

    component.exportReport();

    expect(component.showFiltrosModal).toBe(true);
    expect(component.filtrosModalMode).toBe('actualizar');
    expect(bankServiceSpy.exportMovements).not.toHaveBeenCalled();
  });

  it('al reabrir el panel con configuración guardada, carga esos filtros en vez de los defaults', () => {
    filtrosService.guardar(USER.id, ENTIDAD.rfc, {
      bancos: ['BBVA'],
      statuses: ['identificado'],
      tipos: ['deposito'],
      categorias: [],
      identificadoPor: [],
      columnas: ['ficha'],
      importeMin: 100,
      importeMax: 2000,
      folioFilter: 'con',
      fichaFilter: 'sin',
    });

    abrirPanel();

    expect(component.reportBancos).toEqual(['BBVA']);
    expect(component.reportStatuses).toEqual(['identificado']);
    expect(component.reportTipos).toEqual(['deposito']);
    expect(component.reportColumnas).toEqual(['ficha']);
    expect(component.importeMin).toBe(100);
    expect(component.importeMax).toBe(2000);
    expect(component.folioFilter).toBe('con');
    expect(component.fichaFilter).toBe('sin');
  });

  // 2026-09-07 — reproduce la condición de carrera real: _loadReportFilters()
  // usa takeUntil(destroy$), pero destroy$ solo se dispara en ngOnDestroy —
  // que NUNCA corre entre aperturas del panel porque <app-report-panel> no
  // está detrás de un *ngIf en banks.component.html (se oculta solo por CSS).
  // Antes del fix: una respuesta lenta de una selección de banco anterior podía
  // llegar DESPUÉS de una más reciente y pisar el estado con datos del banco
  // equivocado. Se usan Subjects manuales (no of(...)) para controlar a mano
  // el orden de resolución: la SEGUNDA llamada resuelve primero.
  it('condición de carrera: una respuesta vieja que llega tarde no debe pisar el estado de la selección más reciente', () => {
    const cats1$ = new Subject<(string | null)[]>();
    const cats2$ = new Subject<(string | null)[]>();
    const ids1$  = new Subject<{ userId: string; nombre: string }[]>();
    const ids2$  = new Subject<{ userId: string; nombre: string }[]>();

    bankServiceSpy.listCategories.and.returnValues(cats1$.asObservable(), cats2$.asObservable());
    bankServiceSpy.listIdentificadores.and.returnValues(ids1$.asObservable(), ids2$.asObservable());

    // Apertura 1: todos los bancos seleccionados (bancoParam undefined) → dispara la 1a llamada.
    abrirPanel();
    expect(bankServiceSpy.listCategories).toHaveBeenCalledTimes(1);

    // Apertura 2 (selección de banco distinta): deselecciona Santander → bancoParam='BBVA' → dispara la 2a llamada.
    component.toggleReportBanco('Santander');
    expect(bankServiceSpy.listCategories).toHaveBeenCalledTimes(2);

    // La SEGUNDA llamada (más reciente) resuelve PRIMERO.
    cats2$.next(['catB']);
    ids2$.next([{ userId: 'u2', nombre: 'Usuario Dos' }]);

    // La PRIMERA llamada (vieja, ya cancelada por el fix) resuelve DESPUÉS.
    cats1$.next(['catA']);
    ids1$.next([{ userId: 'u1', nombre: 'Usuario Uno' }]);

    // El estado final debe reflejar la 2a apertura (BBVA), no la 1a (vieja).
    expect(component.reportCatOptions).toEqual(['catB']);
    expect(component.reportCategorias).toEqual(['catB']);
    expect(component.reportIdOptions).toEqual([{ userId: 'u2', nombre: 'Usuario Dos' }]);
    expect(component.reportIdentificadoPor).toEqual(['u2']);
  });

  it('banco guardado que ya no existe en bankCards se descarta, pero un banco guardado vigente se conserva', () => {
    filtrosService.guardar(USER.id, ENTIDAD.rfc, {
      bancos: ['BBVA', 'BancoFantasma'],
      statuses: ['identificado'],
      tipos: ['deposito'],
      categorias: [],
      identificadoPor: [],
      columnas: ['ficha'],
      importeMin: null,
      importeMax: null,
      folioFilter: 'todos',
      fichaFilter: 'todos',
    });

    abrirPanel();

    // 'BancoFantasma' ya no está en bankCards → se descarta; 'BBVA' sigue vigente → se conserva.
    expect(component.reportBancos).toEqual(['BBVA']);
    // El resto de la config guardada carga normalmente (no se rompe por el banco inválido).
    expect(component.reportStatuses).toEqual(['identificado']);
    expect(component.reportColumnas).toEqual(['ficha']);
  });

  it('categoría/identificadoPor guardados que ya no existen en las opciones vigentes se descartan, se conservan los válidos', () => {
    bankServiceSpy.listCategories.and.returnValue(of(['catA', 'catB']));
    bankServiceSpy.listIdentificadores.and.returnValue(of([
      { userId: 'u1', nombre: 'Usuario Uno' },
      { userId: 'u2', nombre: 'Usuario Dos' },
    ]));

    filtrosService.guardar(USER.id, ENTIDAD.rfc, {
      bancos: ['BBVA', 'Santander'],
      statuses: ['identificado'],
      tipos: ['deposito'],
      categorias: ['catA', 'catFantasma'],
      identificadoPor: ['u1', 'uFantasma'],
      columnas: ['ficha'],
      importeMin: null,
      importeMax: null,
      folioFilter: 'todos',
      fichaFilter: 'todos',
    });

    abrirPanel();

    // 'catFantasma'/'uFantasma' ya no están en las opciones vigentes → se descartan.
    // 'catA'/'u1' siguen vigentes → se conservan.
    expect(component.reportCategorias).toEqual(['catA']);
    expect(component.reportIdentificadoPor).toEqual(['u1']);
  });
});
