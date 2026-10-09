import { TestBed, fakeAsync, tick, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, Subject, of, throwError } from 'rxjs';

import { SystemMonitorComponent } from './system-monitor.component';
import { SystemMonitorService } from '../../core/services/system-monitor.service';
import { ErrorHistorialPunto, HistorialPunto, SystemMonitorSnapshot } from '../../core/models/system-monitor.model';

function snapshotFixture(overrides: Partial<SystemMonitorSnapshot> = {}): SystemMonitorSnapshot {
  return {
    generadoEn: '2026-09-24T12:00:00.000Z',
    estadoGeneral: 'normal',
    requestsPorMinuto: 42,
    requestsEnCurso: 3,
    tasaErrorPct: 0,
    tiempoRespuestaPromedioMs: 85,
    uptimeSegundos: 3725,
    memoria: { rssMb: 120, heapUsedMb: 60, heapTotalMb: 90 },
    memoriaHost: { totalMb: 16384, freeMb: 4096, usadoPct: 75 },
    cpu: { load1: 1.2, load5: 1.1, load15: 0.9, cores: 4 },
    eventLoopLagMs: 4.2,
    salud: { mongo: 'conectado', postgres: 'conectado' },
    serieUltimaHora: Array.from({ length: 60 }, (_, i) => ({ ts: i * 60000, total: i, errores: 0 })),
    erroresRecientes: [],
    ...overrides,
  };
}

function historialFixture(overrides: Partial<HistorialPunto> = {}): HistorialPunto {
  return {
    fecha: '2026-09-24T12:00:00.000Z',
    requestsPorMinuto: 30,
    requestsEnCurso: 1,
    erroresUltimoMinuto: 0,
    tasaErrorPct: 0,
    tiempoRespuestaPromedioMs: 60,
    estadoGeneral: 'normal',
    eventLoopLagMs: 3,
    uptimeSegundos: 1000,
    memoria: { rssMb: 100, heapUsedMb: 50, heapTotalMb: 80 },
    memoriaHost: { totalMb: 16384, freeMb: 8192, usadoPct: 50 },
    cpu: { load1: 0.5, load5: 0.4, load15: 0.3, cores: 4 },
    ...overrides,
  };
}

function errorHistorialFixture(overrides: Partial<ErrorHistorialPunto> = {}): ErrorHistorialPunto {
  return {
    ts: '2026-10-08T12:00:00.000Z',
    metodo: 'GET',
    path: '/api/boom',
    status: 503,
    ...overrides,
  };
}

describe('SystemMonitorComponent (TestBed, Chrome real vía Karma)', () => {
  let serviceSpy: jasmine.SpyObj<SystemMonitorService>;
  let component: SystemMonitorComponent;
  let fixture: ComponentFixture<SystemMonitorComponent>;

  // La compilación (templateUrl/styleUrls externos) es async — se resuelve UNA vez
  // acá; cada test solo cambia serviceSpy.snapshot.and.returnValue(...) y crea su
  // propia instancia del componente antes de disparar detectChanges().
  beforeEach(async () => {
    serviceSpy = jasmine.createSpyObj<SystemMonitorService>('SystemMonitorService', ['snapshot', 'historial', 'erroresHistorial']);
    serviceSpy.snapshot.and.returnValue(of(snapshotFixture()));
    serviceSpy.historial.and.returnValue(of([]));
    serviceSpy.erroresHistorial.and.returnValue(of([]));

    try {
      localStorage.removeItem('numo_system_monitor_historial_collapsed');
      localStorage.removeItem('numo_system_monitor_errores_historial_collapsed');
    } catch { /* no-op en entornos sin localStorage */ }

    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [SystemMonitorComponent],
      providers: [{ provide: SystemMonitorService, useValue: serviceSpy }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  function crear(snapshot$: Observable<SystemMonitorSnapshot>): void {
    serviceSpy.snapshot.and.returnValue(snapshot$);
    fixture = TestBed.createComponent(SystemMonitorComponent);
    component = fixture.componentInstance;
  }

  it('al iniciar: pide el snapshot inmediatamente (sin esperar los 5s) y lo muestra', fakeAsync(() => {
    crear(of(snapshotFixture({ requestsPorMinuto: 99 })));
    fixture.detectChanges();
    tick(0);

    expect(serviceSpy.snapshot).toHaveBeenCalledTimes(1);
    expect(component.loading).toBe(false);
    expect(component.snapshot?.requestsPorMinuto).toBe(99);
    expect(component.error).toBe(false);

    component.ngOnDestroy();
  }));

  it('vuelve a pedir el snapshot cada 5s mientras el componente esté vivo', fakeAsync(() => {
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);
    expect(serviceSpy.snapshot).toHaveBeenCalledTimes(1);

    tick(5000);
    expect(serviceSpy.snapshot).toHaveBeenCalledTimes(2);

    tick(5000);
    expect(serviceSpy.snapshot).toHaveBeenCalledTimes(3);

    component.ngOnDestroy();
  }));

  it('un error de red marca error=true pero NO borra el último snapshot bueno', fakeAsync(() => {
    const subject = new Subject<SystemMonitorSnapshot>();
    crear(subject.asObservable());
    fixture.detectChanges();
    tick(0);

    subject.next(snapshotFixture({ requestsPorMinuto: 10 }));
    expect(component.snapshot?.requestsPorMinuto).toBe(10);
    expect(component.error).toBe(false);

    subject.error(new Error('network down'));
    expect(component.error).toBe(true);
    // El último snapshot bueno se conserva — el panel no debe quedar en blanco.
    expect(component.snapshot?.requestsPorMinuto).toBe(10);

    component.ngOnDestroy();
  }));

  // Fix real (2026-09-24): el catchError original vivía en el subscribe de AFUERA
  // del switchMap — un error ahí completaba la suscripción entera y el interval
  // dejaba de emitir PARA SIEMPRE. Este test prueba el escenario completo: falla
  // un tick, se recupera en el siguiente, y sigue vivo después de eso.
  it('el polling SOBREVIVE a un error — reintenta en el próximo tick y se recupera', fakeAsync(() => {
    let llamada = 0;
    serviceSpy.snapshot.and.callFake(() => {
      llamada += 1;
      if (llamada === 2) return throwError(() => new Error('caída puntual'));
      return of(snapshotFixture({ requestsPorMinuto: llamada * 10 }));
    });
    fixture = TestBed.createComponent(SystemMonitorComponent);
    component = fixture.componentInstance;

    fixture.detectChanges();
    tick(0);
    expect(component.snapshot?.requestsPorMinuto).toBe(10);
    expect(component.error).toBe(false);

    tick(5000); // llamada 2 — falla
    expect(component.error).toBe(true);
    expect(component.snapshot?.requestsPorMinuto).toBe(10); // se conserva el último bueno

    tick(5000); // llamada 3 — el interval SIGUE vivo, se recupera
    expect(component.error).toBe(false);
    expect(component.snapshot?.requestsPorMinuto).toBe(30);
    expect(llamada).toBe(3);

    component.ngOnDestroy();
  }));

  it('ngOnDestroy corta el polling — no se piden más snapshots después', fakeAsync(() => {
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);
    expect(serviceSpy.snapshot).toHaveBeenCalledTimes(1);

    component.ngOnDestroy();
    tick(15000);
    expect(serviceSpy.snapshot).toHaveBeenCalledTimes(1);
  }));

  it('el banner de alerta solo tiene texto cuando estadoGeneral no es "normal"', fakeAsync(() => {
    crear(of(snapshotFixture({ estadoGeneral: 'normal' })));
    fixture.detectChanges();
    tick(0);

    expect(component.bannerTexto('normal')).toBe('');
    expect(component.bannerTexto('degradado')).not.toBe('');
    expect(component.bannerTexto('caido')).not.toBe('');

    component.ngOnDestroy();
  }));

  it('construye el gráfico con 60 puntos (labels de hora + requests + errores)', fakeAsync(() => {
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    expect(component.chartData.labels.length).toBe(60);
    expect(component.chartData.datasets.length).toBe(2);
    expect(component.chartData.datasets[0].data.length).toBe(60);

    component.ngOnDestroy();
  }));

  it('un error desde el primer fetch no propaga una excepción no controlada', fakeAsync(() => {
    crear(throwError(() => new Error('boom')));

    expect(() => {
      fixture.detectChanges();
      tick(0);
    }).not.toThrow();
    expect(component.error).toBe(true);
    expect(component.loading).toBe(false);

    component.ngOnDestroy();
  }));

  // ── Histórico persistente (mejora #3) ───────────────────────────────────────
  it('el histórico arranca colapsado y NO pide datos hasta que se expande (fetch perezoso)', fakeAsync(() => {
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    expect(component.historialCollapsed).toBe(true);
    expect(serviceSpy.historial).not.toHaveBeenCalled();

    component.ngOnDestroy();
  }));

  it('al expandir por primera vez, carga el histórico; al colapsar y reabrir, NO vuelve a pedirlo', fakeAsync(() => {
    serviceSpy.historial.and.returnValue(of([historialFixture()]));
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    component.toggleHistorial(); // expande
    tick(0);
    expect(serviceSpy.historial).toHaveBeenCalledTimes(1);
    expect(component.historialData?.length).toBe(1);

    component.toggleHistorial(); // colapsa
    component.toggleHistorial(); // vuelve a expandir — ya tiene data, no refetch
    tick(0);
    expect(serviceSpy.historial).toHaveBeenCalledTimes(1);

    component.ngOnDestroy();
  }));

  it('onRangoHistorialChange actualiza las fechas y recarga con esos valores', fakeAsync(() => {
    serviceSpy.historial.and.returnValue(of([historialFixture()]));
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    component.onRangoHistorialChange({ fechaInicio: '2026-09-01', fechaFin: '2026-09-24' });
    tick(0);

    expect(component.fechaInicioHistorial).toBe('2026-09-01');
    expect(component.fechaFinHistorial).toBe('2026-09-24');
    expect(serviceSpy.historial).toHaveBeenCalledWith('2026-09-01', '2026-09-24');

    component.ngOnDestroy();
  }));

  it('un error al cargar el histórico marca historialError sin tirar', fakeAsync(() => {
    serviceSpy.historial.and.returnValue(throwError(() => new Error('boom histórico')));
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    component.cargarHistorial();
    tick(0);

    expect(component.historialError).toBe(true);
    expect(component.historialLoading).toBe(false);

    component.ngOnDestroy();
  }));

  it('construye el gráfico del histórico con un punto por fecha', fakeAsync(() => {
    serviceSpy.historial.and.returnValue(of([historialFixture({ requestsPorMinuto: 5 }), historialFixture({ requestsPorMinuto: 8 })]));
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    component.cargarHistorial();
    tick(0);

    expect(component.historialChartData.labels.length).toBe(2);
    expect(component.historialChartData.datasets[0].data).toEqual([5, 8]);

    component.ngOnDestroy();
  }));

  // ── Histórico de errores persistidos ─────────────────────────────────────────
  it('el histórico de errores arranca colapsado y NO pide datos hasta que se expande (fetch perezoso)', fakeAsync(() => {
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    expect(component.erroresHistorialCollapsed).toBe(true);
    expect(serviceSpy.erroresHistorial).not.toHaveBeenCalled();

    component.ngOnDestroy();
  }));

  it('al expandir el histórico de errores por primera vez, lo carga; al colapsar y reabrir, NO vuelve a pedirlo', fakeAsync(() => {
    serviceSpy.erroresHistorial.and.returnValue(of([errorHistorialFixture()]));
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    component.toggleErroresHistorial(); // expande
    tick(0);
    expect(serviceSpy.erroresHistorial).toHaveBeenCalledTimes(1);
    expect(component.erroresHistorialData?.length).toBe(1);

    component.toggleErroresHistorial(); // colapsa
    component.toggleErroresHistorial(); // vuelve a expandir — ya tiene data, no refetch
    tick(0);
    expect(serviceSpy.erroresHistorial).toHaveBeenCalledTimes(1);

    component.ngOnDestroy();
  }));

  it('onRangoErroresHistorialChange actualiza las fechas y recarga con esos valores', fakeAsync(() => {
    serviceSpy.erroresHistorial.and.returnValue(of([errorHistorialFixture()]));
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    component.onRangoErroresHistorialChange({ fechaInicio: '2026-09-01', fechaFin: '2026-09-24' });
    tick(0);

    expect(component.fechaInicioErroresHistorial).toBe('2026-09-01');
    expect(component.fechaFinErroresHistorial).toBe('2026-09-24');
    expect(serviceSpy.erroresHistorial).toHaveBeenCalledWith('2026-09-01', '2026-09-24');

    component.ngOnDestroy();
  }));

  it('un error al cargar el histórico de errores marca erroresHistorialError sin tirar', fakeAsync(() => {
    serviceSpy.erroresHistorial.and.returnValue(throwError(() => new Error('boom histórico de errores')));
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    component.cargarErroresHistorial();
    tick(0);

    expect(component.erroresHistorialError).toBe(true);
    expect(component.erroresHistorialLoading).toBe(false);

    component.ngOnDestroy();
  }));

  it('cargarErroresHistorial puebla erroresHistorialData tal cual lo devuelve el service', fakeAsync(() => {
    serviceSpy.erroresHistorial.and.returnValue(of([
      errorHistorialFixture({ status: 500 }),
      errorHistorialFixture({ status: 503 }),
    ]));
    crear(of(snapshotFixture()));
    fixture.detectChanges();
    tick(0);

    component.cargarErroresHistorial();
    tick(0);

    expect(component.erroresHistorialData?.length).toBe(2);
    expect(component.erroresHistorialData?.map(e => e.status)).toEqual([500, 503]);
    expect(component.erroresHistorialLoading).toBe(false);
    expect(component.erroresHistorialError).toBe(false);

    component.ngOnDestroy();
  }));
});
