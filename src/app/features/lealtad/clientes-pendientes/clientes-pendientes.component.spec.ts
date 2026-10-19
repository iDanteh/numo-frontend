import { fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ClientesPendientesComponent } from './clientes-pendientes.component';
import { LoyaltyService, LoyaltyPendingEnrollment } from '../../../core/services/loyalty.service';

function pendiente(overrides: Partial<LoyaltyPendingEnrollment> = {}): LoyaltyPendingEnrollment {
  return {
    id: 1, nombre: 'Juan Pérez', correo: null, tarjetaLegada: '044',
    saldoLegado: 123, nivelSugerido: 'Bronce', estado: 'pendiente',
    ...overrides,
  };
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
    it('carga pendientes, pages y el TOTAL real (no solo lo que trae esta página)', () => {
      loyalty.listarPendientes.and.returnValue(of({
        pendientes: [pendiente(), pendiente({ id: 2 })], total: 321, page: 1, limit: 20, pages: 17,
      }));

      comp.ngOnInit();

      expect(comp.pendientes.length).toBe(2);
      expect(comp.total).toBe(321); // el número real, no 2
      expect(comp.pages).toBe(17);
      expect(comp.loading).toBe(false);
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

    it('camino feliz: marca salida animada, decrementa el total y luego quita la fila de la lista', fakeAsync(() => {
      const p = pendiente();
      comp.pendientes = [p, pendiente({ id: 2 })];
      comp.total = 321;
      comp.telefonoPorFila[p.id] = '5551234567';
      loyalty.completarPendiente.and.returnValue(of({ card: {} as any, nip: '1234' }));

      comp.completar(p);

      // Salida animada (ver .cp-card--saliendo): el registro queda marcado para
      // salir pero sigue en el array hasta que termina la transición CSS.
      expect(comp.total).toBe(320);
      expect(comp.completando[p.id]).toBe(false);
      expect(comp.salientes[p.id]).toBe(true);
      expect(comp.pendientes.map((x) => x.id)).toEqual([1, 2]);

      tick(280);

      expect(comp.pendientes.map((x) => x.id)).toEqual([2]);
      expect(comp.salientes[p.id]).toBeUndefined();
    }));
  });

  describe('rechazar() / confirmarRechazar() — vía app-confirm-modal, no confirm() nativo', () => {
    it('rechazar() solo abre el modal, no llama al servicio todavía', () => {
      const p = pendiente();
      comp.pendientes = [p];
      comp.total = 1;

      comp.rechazar(p);

      expect(comp.confirmRechazarCard).toBe(p);
      expect(loyalty.rechazarPendiente).not.toHaveBeenCalled();
      expect(comp.pendientes).toEqual([p]);
      expect(comp.total).toBe(1);
    });

    it('cerrarConfirmRechazar() cancela sin llamar al servicio', () => {
      const p = pendiente();
      comp.pendientes = [p];
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
      comp.pendientes = [p, pendiente({ id: 2 })];
      comp.total = 321;
      loyalty.rechazarPendiente.and.returnValue(of({ ...p, estado: 'rechazado' }));

      comp.rechazar(p);
      comp.confirmarRechazar();

      expect(comp.confirmRechazarCard).toBeNull();
      expect(loyalty.rechazarPendiente).toHaveBeenCalledWith(p.id);
      expect(comp.total).toBe(320);
      expect(comp.salientes[p.id]).toBe(true);

      tick(280);

      expect(comp.pendientes.map((x) => x.id)).toEqual([2]);
    }));

    it('error del backend: muestra el mensaje de fila y apaga el spinner, sin tocar la lista', () => {
      const p = pendiente();
      comp.pendientes = [p];
      comp.total = 1;
      loyalty.rechazarPendiente.and.returnValue(throwError(() => ({ error: { error: 'no se pudo' } })));

      comp.rechazar(p);
      comp.confirmarRechazar();

      expect(comp.errorPorFila[p.id]).toBe('no se pudo');
      expect(comp.rechazando[p.id]).toBe(false);
      expect(comp.pendientes).toEqual([p]);
      expect(comp.total).toBe(1);
    });
  });

  describe('rechazarTodos() / confirmarRechazarTodos() — bug real corregido: debe usar el TOTAL, nunca pendientes.length', () => {
    it('el mensaje de confirmación menciona el TOTAL real, no solo los de la página visible', () => {
      // Escenario exacto del bug: 321 pendientes reales, solo 2 cargados en esta página.
      comp.pendientes = [pendiente(), pendiente({ id: 2 })];
      comp.total = 321;

      comp.rechazarTodos();

      expect(comp.confirmRechazarTodos).toBe(true);
      expect(comp.confirmRechazarTodosMsg).toMatch(/321/);
      expect(comp.confirmRechazarTodosMsg).not.toContain(' 2 clientes');
    });

    it('no hace nada si total es 0', () => {
      comp.pendientes = [];
      comp.total = 0;

      comp.rechazarTodos();

      expect(comp.confirmRechazarTodos).toBe(false);
      expect(loyalty.rechazarTodosPendientes).not.toHaveBeenCalled();
    });

    it('cerrarConfirmRechazarTodos() cancela sin llamar al servicio', () => {
      comp.pendientes = [pendiente()];
      comp.total = 1;
      comp.rechazarTodos();

      comp.cerrarConfirmRechazarTodos();

      expect(comp.confirmRechazarTodos).toBe(false);
      expect(loyalty.rechazarTodosPendientes).not.toHaveBeenCalled();
    });

    it('camino feliz: vacía la lista, el total y las páginas, y muestra el mensaje de éxito con el conteo del backend', () => {
      comp.pendientes = [pendiente(), pendiente({ id: 2 })];
      comp.total = 321;
      comp.pages = 17;
      loyalty.rechazarTodosPendientes.and.returnValue(of({ rechazados: 321 }));

      comp.rechazarTodos();
      comp.confirmarRechazarTodos();

      expect(comp.confirmRechazarTodos).toBe(false);
      expect(comp.pendientes).toEqual([]);
      expect(comp.total).toBe(0);
      expect(comp.pages).toBe(1);
      expect(comp.ultimoRechazoMsg).toContain('321');
      expect(comp.rechazandoTodos).toBe(false);
    });

    it('error del backend: muestra el error general y apaga el spinner, sin vaciar la lista', () => {
      comp.pendientes = [pendiente()];
      comp.total = 1;
      loyalty.rechazarTodosPendientes.and.returnValue(throwError(() => ({ error: { error: 'boom' } })));

      comp.rechazarTodos();
      comp.confirmarRechazarTodos();

      expect(comp.error).toBe('boom');
      expect(comp.rechazandoTodos).toBe(false);
      expect(comp.pendientes.length).toBe(1);
    });
  });
});
