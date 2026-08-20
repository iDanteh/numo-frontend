import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { of } from 'rxjs';

import { BankDashboardCarouselComponent } from './bank-dashboard-carousel.component';
import { BankIndicadoresPanelComponent } from '../indicadores-panel/bank-indicadores-panel.component';
import { CollectionRequestService, CollectionRequestIndicadores } from '../../../../core/services/collection-request.service';

// 2026-08-20 (2da corrección): BankIndicadoresPanelComponent ya no llama a
// BankService#indicadores() (el indicador general/backlog/"por usuario" se eliminó del
// panel) — ahora llama a CollectionRequestService#indicadores(), ver
// bank-indicadores-panel.component.ts. Este spec se actualiza para mockear esa
// dependencia real en vez de la anterior.
const INDICADORES_VACIO: CollectionRequestIndicadores = {
  totalSolicitudesResueltas: 0,
  sinMovimientoVinculado: 0,
  total:         { promedioHoras: null, medianaHoras: null, count: 0 },
  fase1Banco:    { promedioHoras: null, medianaHoras: null, count: 0 },
  fase2Contador: { promedioHoras: null, medianaHoras: null, count: 0 },
  porUsuario: [],
};

const STORAGE_KEY = BankDashboardCarouselComponent.STORAGE_KEY;

describe('BankDashboardCarouselComponent — carousel de 2 slides (TestBed, Chrome real vía Karma)', () => {
  let crServiceSpy: jasmine.SpyObj<CollectionRequestService>;
  let component: BankDashboardCarouselComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BankDashboardCarouselComponent>;

  beforeEach(async () => {
    localStorage.removeItem(STORAGE_KEY);

    crServiceSpy = jasmine.createSpyObj<CollectionRequestService>('CollectionRequestService', ['indicadores']);
    crServiceSpy.indicadores.and.returnValue(of(INDICADORES_VACIO));

    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [BankDashboardCarouselComponent, BankIndicadoresPanelComponent],
      providers: [
        { provide: CollectionRequestService, useValue: crServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BankDashboardCarouselComponent);
    component = fixture.componentInstance;

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("arranca en el slide 'kpi' por default (sin nada en localStorage)", () => {
    expect(component.activeSlide).toBe('kpi');
    expect(crServiceSpy.indicadores).not.toHaveBeenCalled();
  });

  it("cambiar a 'indicadores' dispara CollectionRequestService.indicadores() una sola vez (fetch perezoso)", () => {
    expect(crServiceSpy.indicadores).not.toHaveBeenCalled();

    component.selectSlide('indicadores');
    fixture.detectChanges();

    expect(component.activeSlide).toBe('indicadores');
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);
  });

  it('cambiar de slide y volver NO vuelve a llamar al servicio si los filtros no cambiaron (cacheado)', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    component.selectSlide('kpi');
    fixture.detectChanges();
    component.selectSlide('indicadores');
    fixture.detectChanges();

    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);
  });

  it('cambiar year mientras el slide 2 está activo SÍ dispara una nueva llamada, con el year nuevo', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('year', 2027);
    fixture.detectChanges();

    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(2);
    expect(crServiceSpy.indicadores.calls.mostRecent().args[0]).toBe(2027);
  });

  it('cambiar un filtro mientras el slide 2 está INACTIVO no recarga hasta reactivarlo (stale)', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    component.selectSlide('kpi');
    fixture.detectChanges();

    fixture.componentRef.setInput('month', 6);
    fixture.detectChanges();
    // Todavía en 'kpi': el cambio se marca "stale", no dispara un fetch inmediato.
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    component.selectSlide('indicadores');
    fixture.detectChanges();
    // Al reactivar el slide 2 con filtros obsoletos, se recarga.
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(2);
  });

  it('la preferencia de slide se persiste en localStorage y se respeta al recrear el componente', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();

    expect(localStorage.getItem(STORAGE_KEY)).toBe('indicadores');

    const fixture2 = TestBed.createComponent(BankDashboardCarouselComponent);
    fixture2.detectChanges();

    expect(fixture2.componentInstance.activeSlide).toBe('indicadores');
  });
});
