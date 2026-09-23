import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, EMPTY } from 'rxjs';

import { BanksComponent } from './banks.component';
import { BankService, BankCard } from '../../core/services/bank.service';
import { AuthService } from '../../core/services/auth.service';
import { SocketService } from '../../core/services/socket.service';

// ── Fixture: 2 bancos con desgloses de categoría/estatus DISTINTOS entre sí y
// distintos del total del banco — a propósito, para poder afirmar sin ambigüedad
// "el número en pantalla es el de la categoría filtrada, no el del banco completo".
function buildBankCard(overrides: Partial<BankCard>): BankCard {
  return {
    banco: 'BBVA',
    movimientos: 0,
    movimientoNoIdentificado: 0,
    totalDepositos: 0,
    totalRetiros: 0,
    saldoFinal: null,
    saldoPendiente: 0,
    saldoActualizado: null,
    saldoIdentificado: 0,
    saldoOtros: 0,
    saldoOtrosSolo: 0,
    saldoReclasificado: 0,
    ultimaFecha: null,
    ultimaImport: null,
    cuentaContable: null,
    numeroCuenta: null,
    saldoInicial: null,
    saldoInicialFechaCorte: null,
    lastImportBy: null,
    lastImportAt: null,
    porStatus: { no_identificado: 0, identificado: 0, otros: 0, reclasificado: 0 },
    porCategoria: [],
    ...overrides,
  };
}

const BBVA: BankCard = buildBankCard({
  banco: 'BBVA',
  movimientos: 70,
  movimientoNoIdentificado: 40,
  totalDepositos: 100000,
  totalRetiros: 5000,
  saldoFinal: 95000,
  saldoPendiente: 40000,
  saldoIdentificado: 25000,
  saldoOtros: 300,
  saldoOtrosSolo: 300,
  saldoReclasificado: 200,
  ultimaImport: '2026-08-01T10:00:00Z',
  numeroCuenta: '001',
  porStatus: { no_identificado: 40, identificado: 25, otros: 3, reclasificado: 2 },
  porCategoria: [
    {
      categoria: 'Depósito en efectivo', count: 20, monto: 20000,
      porStatus: { no_identificado: 15, identificado: 4, otros: 1, reclasificado: 0 },
      saldoPendiente: 15000, saldoIdentificado: 4000, saldoOtrosSolo: 100, saldoReclasificado: 0,
    },
    {
      categoria: 'Transferencia', count: 50, monto: 80000,
      porStatus: { no_identificado: 25, identificado: 21, otros: 2, reclasificado: 2 },
      saldoPendiente: 25000, saldoIdentificado: 21000, saldoOtrosSolo: 200, saldoReclasificado: 200,
    },
  ],
});

const SANTANDER: BankCard = buildBankCard({
  banco: 'Santander',
  movimientos: 25,
  movimientoNoIdentificado: 10,
  totalDepositos: 30000,
  totalRetiros: 1000,
  saldoFinal: 29000,
  saldoPendiente: 10000,
  saldoIdentificado: 15000,
  saldoOtros: 0,
  saldoOtrosSolo: 0,
  saldoReclasificado: 0,
  ultimaImport: '2026-07-15T10:00:00Z',
  numeroCuenta: '002',
  porStatus: { no_identificado: 10, identificado: 15, otros: 0, reclasificado: 0 },
  porCategoria: [
    {
      categoria: 'Depósito en efectivo', count: 5, monto: 5000,
      porStatus: { no_identificado: 2, identificado: 3, otros: 0, reclasificado: 0 },
      saldoPendiente: 2000, saldoIdentificado: 3000, saldoOtrosSolo: 0, saldoReclasificado: 0,
    },
    {
      categoria: 'Transferencia', count: 20, monto: 25000,
      porStatus: { no_identificado: 8, identificado: 12, otros: 0, reclasificado: 0 },
      saldoPendiente: 8000, saldoIdentificado: 12000, saldoOtrosSolo: 0, saldoReclasificado: 0,
    },
  ],
});

describe('BanksComponent — filtros del dashboard refrescan el DOM (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let component: BanksComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BanksComponent>;
  let el: HTMLElement;

  function text(selector: string): string {
    const node = el.querySelector(selector);
    if (!node) throw new Error(`No se encontró el selector "${selector}" en el DOM renderizado`);
    return (node.textContent ?? '').trim();
  }

  beforeEach(async () => {
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', ['cards', 'years', 'list', 'listarPendientesFicha']);
    bankServiceSpy.cards.and.returnValue(of([BBVA, SANTANDER]));
    bankServiceSpy.years.and.returnValue(of({ years: [2026] }));
    bankServiceSpy.list.and.returnValue(EMPTY as any);
    // Badge/bandeja "Pendientes de ficha" (2026-09-03): ngOnInit la carga siempre que
    // auth.hasPermission('banks:ficha') sea true — este spec mockea hasPermission() para
    // que siempre devuelva true, así que sin este spy TestBed.createComponent revienta
    // con "listarPendientesFicha is not a function".
    bankServiceSpy.listarPendientesFicha.and.returnValue(of({ total: 0, movimientos: [] }));

    const authSpy = {
      hasPermission: jasmine.createSpy('hasPermission').and.returnValue(true),
      hasRole: jasmine.createSpy('hasRole').and.returnValue(false),
      currentUser: { role: 'admin' },
    };

    const socketSpy = {
      movementUpdated$: EMPTY,
      // Badge/bandeja "Pendientes de ficha" (2026-09-03): ngOnInit se suscribe a esto
      // siempre que auth.hasPermission('banks:ficha') sea true (ver arriba) — sin esto
      // TestBed.createComponent revienta al leer socketService.fichaPendienteChanged$
      // de un objeto que no lo tiene.
      fichaPendienteChanged$: EMPTY,
      joinBanco: jasmine.createSpy('joinBanco'),
      leaveBanco: jasmine.createSpy('leaveBanco'),
    };

    // Faltaban en este spec (BanksComponent los inyecta desde la navegación
    // "volver" de Traspasos/Compensaciones — ver ngOnInit#queryParamMap/volver()) —
    // sin esto, TestBed.createComponent tira NullInjectorError: No provider for
    // ActivatedRoute. Mock mínimo: sin querystring (banco/movId ausentes), que es
    // el caso normal de entrar a /banks sin venir de "ver movimientos" de una póliza.
    const activatedRouteStub = {
      snapshot: { queryParamMap: { get: () => null } },
    };
    const routerSpy = { navigate: jasmine.createSpy('navigate') };

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [BanksComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: SocketService, useValue: socketSpy },
        { provide: ActivatedRoute, useValue: activatedRouteStub },
        { provide: Router, useValue: routerSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(BanksComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('carga las 2 tarjetas mockeadas sin filtros', () => {
    expect(component.bankCards.length).toBe(2);
    expect(component.filteredBankCards.length).toBe(2);
  });

  it('sin filtro: los KPI muestran la suma de AMBOS bancos completos', () => {
    // no_identificado: 40 (BBVA) + 10 (Santander) = 50
    expect(text('.stat-card--pending .stat-value')).toBe('50');
    // saldoPendiente: 40,000 + 10,000 = 50,000.00
    expect(text('.stat-card--pending .stat-amount')).toBe('$ 50,000.00');
    // identificado: 25 + 15 = 40
    expect(text('.stat-card--done .stat-value')).toBe('40');
    expect(text('.stat-card--done .stat-amount')).toBe('$ 40,000.00');
    // otros: 3 + 0 = 3 (visible porque auth.hasPermission('banks:config') mockeado en true)
    expect(text('.stat-card--total .stat-value')).toBe('3');
  });

  it('filterCategoria="Depósito en efectivo": los KPI usan EL DESGLOSE DE LA CATEGORÍA, no el banco completo', () => {
    component.filterCategoria = 'Depósito en efectivo';
    fixture.detectChanges();

    // no_identificado de la categoría: 15 (BBVA) + 2 (Santander) = 17 — NI el total sin
    // filtro (50) NI el de la otra categoría "Transferencia" (33) — solo esta categoría.
    expect(text('.stat-card--pending .stat-value')).toBe('17');
    expect(text('.stat-card--pending .stat-amount')).toBe('$ 17,000.00');
    // identificado de la categoría: 4 + 3 = 7 (vs. 40 sin filtro)
    expect(text('.stat-card--done .stat-value')).toBe('7');
    expect(text('.stat-card--done .stat-amount')).toBe('$ 7,000.00');
    // otros de la categoría: 1 + 0 = 1 (vs. 3 sin filtro)
    expect(text('.stat-card--total .stat-value')).toBe('1');
  });

  it('volver filterCategoria a vacío repone los totales del banco completo', () => {
    component.filterCategoria = 'Depósito en efectivo';
    fixture.detectChanges();
    expect(text('.stat-card--pending .stat-value')).toBe('17');

    component.filterCategoria = null;
    fixture.detectChanges();
    expect(text('.stat-card--pending .stat-value')).toBe('50');
  });

  it('filterStatus sin excluir ningún banco (todos tienen ese estatus): la lista y los KPI NO cambian', () => {
    // no_identificado: BBVA=40>0, Santander=10>0 — ningún banco queda fuera de filteredBankCards.
    component.filterStatus = 'no_identificado';
    fixture.detectChanges();

    expect(component.filteredBankCards.length).toBe(2);
    expect(el.querySelectorAll('.banks-table-row').length).toBe(2);
    expect(text('.stat-card--pending .stat-value')).toBe('50');
    expect(text('.stat-card--done .stat-value')).toBe('40');
  });

  it('Fix 2026-08-13: filterStatus que excluye un banco entero de la LISTA ya NO afecta los KPI', () => {
    // otros: BBVA=3>0 (entra a filteredBankCards), Santander=0 (queda fuera de la LISTA).
    component.filterStatus = 'otros';
    fixture.detectChanges();

    // (a) La lista sigue acotándose a 1 banco (BBVA) — el filtro de fila no cambió.
    expect(component.filteredBankCards.length).toBe(1);
    expect(component.filteredBankCards[0].banco).toBe('BBVA');
    expect(el.querySelectorAll('.banks-table-row').length).toBe(1);

    // (b) Pero dashboardTotals/totalSaldoPendiente ahora suman sobre bankCardsForKpi (sin
    // filterStatus) — Santander sigue aportando sus 10/15 movimientos al KPI aunque haya
    // desaparecido de la lista. Los 4 buckets quedan estables, como decidió el usuario.
    expect(component.dashboardTotals.no_identificado).toBe(50);
    expect(component.dashboardTotals.identificado).toBe(40);
    expect(text('.stat-card--pending .stat-value')).toBe('50');
    expect(text('.stat-card--done .stat-value')).toBe('40');
  });

  // Pedido explícito del usuario 2026-09-08: al elegir "Cargar Ficha" desde la bandeja de
  // pendientes, el panel debe ocultarse (foco en el modal ERP) y reabrirse solo al
  // terminar (cerrar o guardar), para seguir con el resto de la cola — antes se quedaba
  // abierto detrás del modal todo el tiempo.
  describe('onAbrirFichaDesdePendientes — ocultar/reabrir el panel de pendientes de ficha', () => {
    const mov = { _id: 'mov-1' } as any;

    it('oculta el panel de pendientes y abre el modal ERP', () => {
      component.mostrarFichaPendientePanel = true;

      component.onAbrirFichaDesdePendientes(mov);

      expect(component.mostrarFichaPendientePanel).toBe(false);
      expect(component.showErpModal).toBe(true);
      expect(component.erpModalMovement).toBe(mov);
    });

    it('al cerrar el modal (X/cancelar), reabre el panel de pendientes', () => {
      component.onAbrirFichaDesdePendientes(mov);

      component.onErpModalClosed();

      expect(component.showErpModal).toBe(false);
      expect(component.mostrarFichaPendientePanel).toBe(true);
    });

    it('al guardar la ficha, reabre el panel de pendientes', () => {
      component.onAbrirFichaDesdePendientes(mov);

      component.onErpSaved({ folio: 'F-1', hasErpIds: true });

      expect(component.showErpModal).toBe(false);
      expect(component.mostrarFichaPendientePanel).toBe(true);
    });

    it('abrir el modal por OTRA vía (ej. fila de la tabla) NO reabre el panel de pendientes al cerrar', () => {
      component.openErpModal(mov);

      component.onErpModalClosed();

      expect(component.mostrarFichaPendientePanel).toBe(false);
    });
  });

  // Mismo patrón que onAbrirFichaDesdePendientes, para el panel "Transferencias entre
  // cajas" (2026-09-14): sin esto, el modal ERP se abría con z-index MENOR que el panel
  // lateral y quedaba literalmente detrás, inalcanzable hasta cerrar el panel a mano.
  describe('onAbrirFichaDesdeTransferencias — ocultar/reabrir el panel de transferencias entre cajas', () => {
    const mov = { _id: 'mov-1' } as any;

    it('oculta el panel de transferencias y abre el modal ERP', () => {
      component.showTransferenciasCajaPanel = true;

      component.onAbrirFichaDesdeTransferencias(mov);

      expect(component.showTransferenciasCajaPanel).toBe(false);
      expect(component.showErpModal).toBe(true);
      expect(component.erpModalMovement).toBe(mov);
    });

    it('al cerrar el modal (X/cancelar), reabre el panel de transferencias', () => {
      component.onAbrirFichaDesdeTransferencias(mov);

      component.onErpModalClosed();

      expect(component.showErpModal).toBe(false);
      expect(component.showTransferenciasCajaPanel).toBe(true);
    });

    it('al guardar la ficha, reabre el panel de transferencias', () => {
      component.onAbrirFichaDesdeTransferencias(mov);

      component.onErpSaved({ folio: 'F-1', hasErpIds: true });

      expect(component.showErpModal).toBe(false);
      expect(component.showTransferenciasCajaPanel).toBe(true);
    });

    it('abrir el modal por OTRA vía (ej. fila de la tabla) NO reabre el panel de transferencias al cerrar', () => {
      component.openErpModal(mov);

      component.onErpModalClosed();

      expect(component.showTransferenciasCajaPanel).toBe(false);
    });

    it('los dos orígenes (pendientes de ficha y transferencias) no se pisan entre sí', () => {
      component.mostrarFichaPendientePanel = false;
      component.showTransferenciasCajaPanel = false;

      component.onAbrirFichaDesdeTransferencias(mov);
      component.onErpModalClosed();

      expect(component.showTransferenciasCajaPanel).toBe(true);
      expect(component.mostrarFichaPendientePanel).toBe(false);
    });
  });

  // otrosFormaPagoTotal — "Otros" en el dropdown "CxC vinculadas" (pedido explícito del
  // usuario, 2026-09-04): suma de las formas de pago NO bancarias del desglose de TODOS
  // los erpLinks de un movimiento — mismo criterio de "bancaria" ya usado y testeado en
  // collection-request-erp-links.test.js (backend), replicado a propósito acá.
  describe('otrosFormaPagoTotal', () => {
    function movConLinks(erpLinks: any[]): any {
      return { erpLinks };
    }

    it('suma solo las formas NO bancarias (ej. Anticipo), ignora Transferencia/Cheque/Depósito en efectivo', () => {
      const mov = movConLinks([{
        erpId: 'CXC-1',
        desglosePorFormaPago: [
          { formaPagoDescripcion: 'Transferencia', monto: 60000 },
          { formaPagoDescripcion: 'Anticipo', monto: 15000 },
          { formaPagoDescripcion: 'Cheque', monto: 5000 },
        ],
      }]);

      expect(component.otrosFormaPagoTotal(mov)).toBe(15000);
    });

    it('suma across TODOS los erpLinks del movimiento, no solo el primero', () => {
      const mov = movConLinks([
        { erpId: 'CXC-1', desglosePorFormaPago: [{ formaPagoDescripcion: 'Anticipo', monto: 1000 }] },
        { erpId: 'CXC-2', desglosePorFormaPago: [{ formaPagoDescripcion: 'Efectivo', monto: 2000 }] },
      ]);

      expect(component.otrosFormaPagoTotal(mov)).toBe(3000);
    });

    it('sin ninguna forma no-bancaria: da 0 (la fila "Otros" no debe mostrarse)', () => {
      const mov = movConLinks([{
        erpId: 'CXC-1',
        desglosePorFormaPago: [{ formaPagoDescripcion: 'Transferencia', monto: 60000 }],
      }]);

      expect(component.otrosFormaPagoTotal(mov)).toBe(0);
    });

    it('sin erpLinks: da 0, no rompe', () => {
      expect(component.otrosFormaPagoTotal(movConLinks([]))).toBe(0);
      expect(component.otrosFormaPagoTotal({} as any)).toBe(0);
    });
  });

  // 2026-09-23 — exportar la vista filtrada del dashboard "Estatus" reusando app-report-panel
  // (ver plan en C:\Users\proye\.claude\plans\typed-roaming-prism.md). exportEstatusView()
  // traduce año/mes a fechaInicio/fechaFin y arma el prefill desde banco/categoría/estatus.
  describe('exportEstatusView / openReportPanel — prefill hacia app-report-panel', () => {
    it('mes elegido: fechaInicio/fechaFin cubren exactamente ese mes, arma el prefill desde los filtros activos', () => {
      component.dashboardBanco  = 'BBVA';
      component.filterCategoria = 'Transferencia';
      component.filterStatus    = 'identificado';
      component.dashboardYear   = 2026;
      component.dashboardMonth  = 3;

      component.exportEstatusView();

      expect(component.reportFechaInicio).toBe('2026-03-01');
      expect(component.reportFechaFin).toBe('2026-03-31');
      expect(component.reportPrefill).toEqual({ banco: 'BBVA', categoria: 'Transferencia', status: 'identificado' });
      expect(component.showReportPanel).toBe(true);
    });

    it('diciembre: el último día del mes no se corre al año siguiente', () => {
      component.dashboardYear  = 2026;
      component.dashboardMonth = 12;

      component.exportEstatusView();

      expect(component.reportFechaInicio).toBe('2026-12-01');
      expect(component.reportFechaFin).toBe('2026-12-31');
    });

    it('solo año (sin mes): fechaInicio/fechaFin cubren el año completo', () => {
      component.dashboardYear  = 2026;
      component.dashboardMonth = null;

      component.exportEstatusView();

      expect(component.reportFechaInicio).toBe('2026-01-01');
      expect(component.reportFechaFin).toBe('2026-12-31');
    });

    it('sin año: fechaInicio/fechaFin quedan vacíos (todas las fechas)', () => {
      component.dashboardYear  = null;
      component.dashboardMonth = null;

      component.exportEstatusView();

      expect(component.reportFechaInicio).toBe('');
      expect(component.reportFechaFin).toBe('');
    });

    it('openReportPanel() sin argumentos (botón genérico de Reportes) resetea reportPrefill a null', () => {
      component.reportPrefill = { banco: 'BBVA', categoria: null, status: '' };

      component.openReportPanel();

      expect(component.reportPrefill).toBeNull();
      expect(component.reportFechaInicio).toBe('');
      expect(component.reportFechaFin).toBe('');
      expect(component.showReportPanel).toBe(true);
    });

    it('botón "Exportar" del toolbar visible solo con permiso banks:export', () => {
      expect(el.querySelector('.btn-export')).toBeTruthy();

      (component.auth.hasPermission as jasmine.Spy).and.returnValue(false);
      fixture.detectChanges();

      expect(el.querySelector('.btn-export')).toBeFalsy();
    });

    it('spinner de carga junto a año/mes visible solo mientras cardsLoading es true', () => {
      component.cardsLoading = false;
      fixture.detectChanges();
      expect(el.querySelector('.period-loading-spinner')).toBeFalsy();

      component.cardsLoading = true;
      fixture.detectChanges();
      expect(el.querySelector('.period-loading-spinner')).toBeTruthy();
    });
  });

  // 2026-09-23 — rango continuo en el dashboard "Estatus" ("combinar meses" pedido por el
  // usuario), mismo patrón de precedencia que bank-cobranza-panel.component.ts: un rango
  // explícito gana sobre año/mes.
  describe('Rango continuo de fechas — onDashboardRangoChange / precedencia sobre año/mes', () => {
    function ultimaLlamadaACards(): unknown[] {
      return bankServiceSpy.cards.calls.mostRecent().args;
    }

    it('sin rango: bankService.cards se llama con year/month tal cual, sin fechas (comportamiento previo intacto)', () => {
      component.dashboardYear  = 2026;
      component.dashboardMonth = 3;
      bankServiceSpy.cards.calls.reset();

      component.loadCards();

      expect(ultimaLlamadaACards()).toEqual([2026, 3, undefined, undefined]);
    });

    it('con rango activo: year/month se mandan en null y el rango ocupa su lugar', () => {
      component.dashboardYear  = 2026;
      component.dashboardMonth = 3;
      bankServiceSpy.cards.calls.reset();

      component.onDashboardRangoChange({ fechaInicio: '2026-01-01', fechaFin: '2026-03-31' });

      expect(component.dashboardFechaInicio).toBe('2026-01-01');
      expect(component.dashboardFechaFin).toBe('2026-03-31');
      // Un rango real también limpia año/mes en el estado del componente (no solo en la
      // llamada al service) — vuelven a "Todos los años"/"Todos los meses" en la UI, en vez
      // de quedar deshabilitados con un valor viejo debajo (2026-09-23).
      expect(component.dashboardYear).toBeNull();
      expect(component.dashboardMonth).toBeNull();
      expect(ultimaLlamadaACards()).toEqual([null, null, '2026-01-01', '2026-03-31']);
    });

    it('limpiar el rango (ambos vacíos) NO modifica año/mes', () => {
      component.dashboardYear        = 2026;
      component.dashboardMonth       = 3;
      component.dashboardFechaInicio = '2026-01-01';
      component.dashboardFechaFin    = '2026-03-31';

      component.onDashboardRangoChange({ fechaInicio: '', fechaFin: '' });

      expect(component.dashboardYear).toBe(2026);
      expect(component.dashboardMonth).toBe(3);
    });

    it('elegir año limpia un rango de fechas activo', () => {
      component.onDashboardRangoChange({ fechaInicio: '2026-01-01', fechaFin: '2026-03-31' });
      component.dashboardYear = 2025;
      bankServiceSpy.cards.calls.reset();

      component.onDashboardYearChange();

      expect(component.dashboardFechaInicio).toBe('');
      expect(component.dashboardFechaFin).toBe('');
      expect(bankServiceSpy.cards).toHaveBeenCalled();
    });

    it('elegir mes limpia un rango de fechas activo', () => {
      component.dashboardYear = 2026;
      component.onDashboardRangoChange({ fechaInicio: '2026-01-01', fechaFin: '2026-03-31' });
      component.dashboardMonth = 5;
      bankServiceSpy.cards.calls.reset();

      component.onDashboardMonthChange();

      expect(component.dashboardFechaInicio).toBe('');
      expect(component.dashboardFechaFin).toBe('');
      expect(bankServiceSpy.cards).toHaveBeenCalled();
    });

    it('chip "Periodo" aparece con rango activo (reemplaza a los de año/mes) y se puede quitar', () => {
      component.dashboardYear  = 2026;
      component.dashboardMonth = 3;
      component.onDashboardRangoChange({ fechaInicio: '2026-01-01', fechaFin: '2026-03-31' });

      expect(component.activeFilterChips).toContain({ key: 'rango', label: 'Periodo: 01/01/26–31/03/26' });
      expect(component.activeFilterChips.some(c => c.key === 'year' || c.key === 'month')).toBe(false);

      bankServiceSpy.cards.calls.reset();
      component.removeFilterChip('rango');

      expect(component.dashboardFechaInicio).toBe('');
      expect(component.dashboardFechaFin).toBe('');
      expect(bankServiceSpy.cards).toHaveBeenCalled();
    });

    it('resetCardsFilters() también limpia el rango y recarga', () => {
      component.dashboardBanco = 'BBVA';
      component.onDashboardRangoChange({ fechaInicio: '2026-01-01', fechaFin: '2026-03-31' });
      bankServiceSpy.cards.calls.reset();

      component.resetCardsFilters();

      expect(component.dashboardFechaInicio).toBe('');
      expect(component.dashboardFechaFin).toBe('');
      expect(bankServiceSpy.cards).toHaveBeenCalled();
    });

    // `[disabled]` en un elemento con `[(ngModel)]` lo intercepta el propio `@Input('disabled')`
    // de NgModel (no un binding DOM directo) — su `setDisabledState()` real se aplica dentro de
    // un microtask (`Promise.resolve().then(...)` interno de Angular Forms), así que hace falta
    // esperar esa estabilización antes de leer `.disabled` (confirmado por depuración: sin este
    // `await`, `ng-reflect-is-disabled` ya decía "true" pero la propiedad DOM real seguía en
    // `false`). Mismo criterio que cualquier `whenStable()` ya usado en el resto de este spec.
    it('selects de año/mes quedan deshabilitados mientras hay un rango explícito activo', async () => {
      const selYear  = el.querySelector('select[aria-label="Filtrar por año"]')  as HTMLSelectElement;
      const selMonth = el.querySelector('select[aria-label="Filtrar por mes"]')  as HTMLSelectElement;
      expect(selYear.disabled).toBe(false);

      component.onDashboardRangoChange({ fechaInicio: '2026-01-01', fechaFin: '2026-03-31' });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(selYear.disabled).toBe(true);
      expect(selMonth.disabled).toBe(true);
    });
  });
});
