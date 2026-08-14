import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NO_ERRORS_SCHEMA } from '@angular/core';
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
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', ['cards', 'years', 'list']);
    bankServiceSpy.cards.and.returnValue(of([BBVA, SANTANDER]));
    bankServiceSpy.years.and.returnValue(of({ years: [2026] }));
    bankServiceSpy.list.and.returnValue(EMPTY as any);

    const authSpy = {
      hasPermission: jasmine.createSpy('hasPermission').and.returnValue(true),
      hasRole: jasmine.createSpy('hasRole').and.returnValue(false),
      currentUser: { role: 'admin' },
    };

    const socketSpy = {
      movementUpdated$: EMPTY,
      joinBanco: jasmine.createSpy('joinBanco'),
      leaveBanco: jasmine.createSpy('leaveBanco'),
    };

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [BanksComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: SocketService, useValue: socketSpy },
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
});
