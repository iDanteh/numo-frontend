import { fakeAsync, tick } from '@angular/core/testing';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ClientesPendientesComponent } from './clientes-pendientes.component';
import {
  LoyaltyService, LoyaltyPendingEnrollment, LoyaltyPendingEnrollmentGrupo,
} from '../../../core/services/loyalty.service';

function pendiente(overrides: Partial<LoyaltyPendingEnrollment> = {}): LoyaltyPendingEnrollment {
  return {
    id: 1, nombre: 'Juan Pérez', correo: null, tarjetaLegada: '044',
    saldoLegado: 123, nivelSugerido: 'Bronce', estado: 'pendiente',
    motivo: 'sin_telefono', grupoId: null, telefonoCandidato: null,
    ...overrides,
  };
}

/** Un grupo de N items — por default un grupo "suelto" de 1 (grupoId null, motivo
 *  'sin_telefono'), igual que devuelve hoy el backend para cada pendiente sin conflicto. */
function grupo(items: LoyaltyPendingEnrollment[], grupoId: string | null = null): LoyaltyPendingEnrollmentGrupo {
  return { grupoId, saldoMax: Math.max(...items.map((i) => i.saldoLegado)), items };
}

/** Aplana todos los items de todos los grupos, en orden — equivalente al viejo `comp.pendientes`. */
function idsDe(comp: ClientesPendientesComponent): number[] {
  return comp.grupos.flatMap((g) => g.items.map((i) => i.id));
}

describe('ClientesPendientesComponent', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let comp: ClientesPendientesComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'listarPendientes', 'completarPendiente', 'rechazarPendiente', 'rechazarTodosPendientes',
    ]);
    comp = new ClientesPendientesComponent(loyalty);
  });

  describe('cargar()', () => {
    it('carga grupos, pages, total (grupos) y totalRegistros (filas reales, no solo las de esta página)', () => {
      loyalty.listarPendientes.and.returnValue(of({
        grupos: [grupo([pendiente()]), grupo([pendiente({ id: 2 })])],
        total: 150, totalRegistros: 321, page: 1, limit: 20, pages: 17,
      }));

      comp.ngOnInit();

      expect(comp.grupos.length).toBe(2);
      expect(comp.total).toBe(150); // grupos, no filas
      expect(comp.totalRegistros).toBe(321); // el número real de filas, no 2
      expect(comp.pages).toBe(17);
      expect(comp.loading).toBe(false);
    });

    it('prellena telefonoPorFila con telefonoCandidato (motivo telefono_duplicado)', () => {
      const p = pendiente({ id: 5, motivo: 'telefono_duplicado', grupoId: '5551234567', telefonoCandidato: '5551234567' });
      loyalty.listarPendientes.and.returnValue(of({
        grupos: [grupo([p], '5551234567')], total: 1, totalRegistros: 1, page: 1, limit: 20, pages: 1,
      }));

      comp.ngOnInit();

      expect(comp.telefonoPorFila[5]).toBe('5551234567');
    });

    it('error: expone un mensaje y apaga loading', () => {
      loyalty.listarPendientes.and.returnValue(throwError(() => ({ error: { error: 'boom' } })));
      comp.ngOnInit();
      expect(comp.error).toBe('boom');
      expect(comp.loading).toBe(false);
    });
  });

  describe('completar()', () => {
    it('sin teléfono capturado: muestra error de fila y NO llama al servicio', () => {
      const p = pendiente();
      comp.telefonoPorFila[p.id] = '  ';
      comp.completar(p);
      expect(loyalty.completarPendiente).not.toHaveBeenCalled();
      expect(comp.errorPorFila[p.id]).toContain('teléfono');
    });

    it('teléfono con formato inválido: muestra error de fila y NO llama al servicio', () => {
      const p = pendiente();
      comp.telefonoPorFila[p.id] = '12345';
      comp.completar(p);
      expect(loyalty.completarPendiente).not.toHaveBeenCalled();
      expect(comp.errorPorFila[p.id]).toContain('10 dígitos');
    });

    it('camino feliz (grupo de 1): marca salida animada, decrementa total Y totalRegistros, y luego quita la fila', fakeAsync(() => {
      const p = pendiente();
      comp.grupos = [grupo([p]), grupo([pendiente({ id: 2 })])];
      comp.total = 321;
      comp.totalRegistros = 321;
      comp.telefonoPorFila[p.id] = '5551234567';
      loyalty.completarPendiente.and.returnValue(of({ card: {} as any, nip: '1234' }));

      comp.completar(p);

      // Salida animada (ver .cp-card--saliendo): el registro queda marcado para
      // salir pero sigue en el array hasta que termina la transición CSS.
      expect(comp.total).toBe(320);
      expect(comp.totalRegistros).toBe(320);
      expect(comp.completando[p.id]).toBe(false);
      expect(comp.salientes[p.id]).toBe(true);
      expect(idsDe(comp)).toEqual([1, 2]);

      tick(280);

      expect(idsDe(comp)).toEqual([2]);
      expect(comp.salientes[p.id]).toBeUndefined();
    }));

    it('completar UN item de un grupo de 2 (telefono_duplicado): baja totalRegistros pero NO total (el grupo sigue existiendo)', fakeAsync(() => {
      const p1 = pendiente({ id: 1, motivo: 'telefono_duplicado', grupoId: '5551234567' });
      const p2 = pendiente({ id: 2, motivo: 'telefono_duplicado', grupoId: '5551234567' });
      comp.grupos = [grupo([p1, p2], '5551234567')];
      comp.total = 10;
      comp.totalRegistros = 10;
      comp.telefonoPorFila[p1.id] = '5551234567';
      loyalty.completarPendiente.and.returnValue(of({ card: {} as any, nip: '1234' }));

      comp.completar(p1);
      tick(280);

      expect(comp.totalRegistros).toBe(9);
      expect(comp.total).toBe(10); // el grupo todavía tiene a p2 — sigue siendo 1 grupo
      expect(idsDe(comp)).toEqual([2]);
    }));
  });

  describe('rechazar() / confirmarRechazar() — vía app-confirm-modal, no confirm() nativo', () => {
    it('rechazar() solo abre el modal, no llama al servicio todavía', () => {
      const p = pendiente();
      comp.grupos = [grupo([p])];
      comp.total = 1;
      comp.totalRegistros = 1;

      comp.rechazar(p);

      expect(comp.confirmRechazarCard).toBe(p);
      expect(loyalty.rechazarPendiente).not.toHaveBeenCalled();
      expect(idsDe(comp)).toEqual([1]);
      expect(comp.total).toBe(1);
    });

    it('cerrarConfirmRechazar() cancela sin llamar al servicio', () => {
      const p = pendiente();
      comp.grupos = [grupo([p])];
      comp.rechazar(p);

      comp.cerrarConfirmRechazar();

      expect(comp.confirmRechazarCard).toBeNull();
      expect(loyalty.rechazarPendiente).not.toHaveBeenCalled();
    });

    it('confirmRechazarMsg escapa el nombre (viene de CSV importado, texto libre) antes de interpolarlo', () => {
      const p = pendiente({ nombre: '<a href="http://evil.example">x</a>' });
      comp.rechazar(p);

      expect(comp.confirmRechazarMsg).not.toContain('<a href');
      expect(comp.confirmRechazarMsg).toContain('&lt;a href');
    });

    it('camino feliz: confirmarRechazar() llama al servicio, marca salida animada y luego quita la fila', fakeAsync(() => {
      const p = pendiente();
      comp.grupos = [grupo([p]), grupo([pendiente({ id: 2 })])];
      comp.total = 321;
      comp.totalRegistros = 321;
      loyalty.rechazarPendiente.and.returnValue(of({ ...p, estado: 'rechazado' }));

      comp.rechazar(p);
      comp.confirmarRechazar();

      expect(comp.confirmRechazarCard).toBeNull();
      expect(loyalty.rechazarPendiente).toHaveBeenCalledWith(p.id);
      expect(comp.total).toBe(320);
      expect(comp.totalRegistros).toBe(320);
      expect(comp.salientes[p.id]).toBe(true);

      tick(280);

      expect(idsDe(comp)).toEqual([2]);
    }));

    it('error del backend: muestra el mensaje de fila y apaga el spinner, sin tocar la lista', () => {
      const p = pendiente();
      comp.grupos = [grupo([p])];
      comp.total = 1;
      comp.totalRegistros = 1;
      loyalty.rechazarPendiente.and.returnValue(throwError(() => ({ error: { error: 'no se pudo' } })));

      comp.rechazar(p);
      comp.confirmarRechazar();

      expect(comp.errorPorFila[p.id]).toBe('no se pudo');
      expect(comp.rechazando[p.id]).toBe(false);
      expect(idsDe(comp)).toEqual([1]);
      expect(comp.total).toBe(1);
    });
  });

  describe('rechazarTodos() / confirmarRechazarTodos() — bug real corregido: debe usar totalRegistros, nunca el largo de grupos/items', () => {
    it('el mensaje de confirmación menciona el TOTAL REAL de filas, no solo los de la página visible ni la cantidad de grupos', () => {
      // Escenario exacto del bug: 321 pendientes reales (150 grupos), solo 2 cargados en esta página.
      comp.grupos = [grupo([pendiente()]), grupo([pendiente({ id: 2 })])];
      comp.total = 150;
      comp.totalRegistros = 321;

      comp.rechazarTodos();

      expect(comp.confirmRechazarTodos).toBe(true);
      expect(comp.confirmRechazarTodosMsg).toMatch(/321/);
      expect(comp.confirmRechazarTodosMsg).not.toContain(' 2 clientes');
      expect(comp.confirmRechazarTodosMsg).not.toContain(' 150 clientes');
    });

    it('no hace nada si totalRegistros es 0', () => {
      comp.grupos = [];
      comp.total = 0;
      comp.totalRegistros = 0;

      comp.rechazarTodos();

      expect(comp.confirmRechazarTodos).toBe(false);
      expect(loyalty.rechazarTodosPendientes).not.toHaveBeenCalled();
    });

    it('cerrarConfirmRechazarTodos() cancela sin llamar al servicio', () => {
      comp.grupos = [grupo([pendiente()])];
      comp.total = 1;
      comp.totalRegistros = 1;
      comp.rechazarTodos();

      comp.cerrarConfirmRechazarTodos();

      expect(comp.confirmRechazarTodos).toBe(false);
      expect(loyalty.rechazarTodosPendientes).not.toHaveBeenCalled();
    });

    it('camino feliz: vacía los grupos, total, totalRegistros y las páginas, y muestra el mensaje de éxito con el conteo del backend', () => {
      comp.grupos = [grupo([pendiente()]), grupo([pendiente({ id: 2 })])];
      comp.total = 150;
      comp.totalRegistros = 321;
      comp.pages = 17;
      loyalty.rechazarTodosPendientes.and.returnValue(of({ rechazados: 321 }));

      comp.rechazarTodos();
      comp.confirmarRechazarTodos();

      expect(comp.confirmRechazarTodos).toBe(false);
      expect(comp.grupos).toEqual([]);
      expect(comp.total).toBe(0);
      expect(comp.totalRegistros).toBe(0);
      expect(comp.pages).toBe(1);
      expect(comp.ultimoRechazoMsg).toContain('321');
      expect(comp.rechazandoTodos).toBe(false);
    });

    it('error del backend: muestra el error general y apaga el spinner, sin vaciar la lista', () => {
      comp.grupos = [grupo([pendiente()])];
      comp.total = 1;
      comp.totalRegistros = 1;
      loyalty.rechazarTodosPendientes.and.returnValue(throwError(() => ({ error: { error: 'boom' } })));

      comp.rechazarTodos();
      comp.confirmarRechazarTodos();

      expect(comp.error).toBe('boom');
      expect(comp.rechazandoTodos).toBe(false);
      expect(idsDe(comp).length).toBe(1);
    });
  });
});

/**
 * Template real (TestBed) — 2026-10-23: confirma que el agrupado por `grupoId` realmente se
 * refleja en el DOM (`.cp-grupo` solo envuelve un grupo con 2+ items), no solo en el modelo.
 * NO_ERRORS_SCHEMA ignora elementos/atributos desconocidos (app-confirm-modal, ngModel sin
 * FormsModule) — alcanza para esto, no hace falta montar el módulo de Lealtad completo.
 */
describe('ClientesPendientesComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<ClientesPendientesComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'listarPendientes', 'completarPendiente', 'rechazarPendiente', 'rechazarTodosPendientes',
    ]);
    loyalty.listarPendientes.and.returnValue(of({
      grupos: [], total: 0, totalRegistros: 0, page: 1, limit: 20, pages: 1,
    }));

    await TestBed.configureTestingModule({
      declarations: [ClientesPendientesComponent],
      providers: [{ provide: LoyaltyService, useValue: loyalty }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientesPendientesComponent);
  });

  it('un grupo con 2+ items se envuelve en .cp-grupo; un grupo de 1 se muestra sin el wrapper', () => {
    const conflicto = grupo(
      [pendiente({ id: 1, motivo: 'telefono_duplicado', grupoId: '5551234567' }), pendiente({ id: 2, motivo: 'telefono_duplicado', grupoId: '5551234567' })],
      '5551234567',
    );
    const suelto = grupo([pendiente({ id: 3 })]);
    // ngOnInit() corre en el primer detectChanges() y llama a cargar(), que pisaría cualquier
    // `grupos` seteado a mano antes — hay que alimentar el dato REAL vía el mock del servicio.
    loyalty.listarPendientes.and.returnValue(of({
      grupos: [conflicto, suelto], total: 2, totalRegistros: 3, page: 1, limit: 20, pages: 1,
    }));
    fixture.detectChanges();

    const wrappers = fixture.nativeElement.querySelectorAll('.cp-grupo');
    expect(wrappers.length).toBe(1);
    expect(wrappers[0].querySelectorAll('.cp-card').length).toBe(2);

    const cardsSueltas = fixture.nativeElement.querySelectorAll('.cp-grid > .cp-card');
    expect(cardsSueltas.length).toBe(1);
  });
});
