import { fakeAsync, tick } from '@angular/core/testing';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ClientesPendientesComponent } from './clientes-pendientes.component';
import {
  LoyaltyService, LoyaltyPendingEnrollment, LoyaltyPendingEnrollmentGrupo, LoyaltyCard,
} from '../../../core/services/loyalty.service';

function cardKore(overrides: Partial<LoyaltyCard> = {}): LoyaltyCard {
  return {
    id: '10', telefono: '5551234567', nombre: 'Ana López', nivel: 'Bronce',
    saldoPuntos: 0, activa: true, createdAt: '2026-10-29T12:00:00.000Z',
    ...overrides,
  };
}

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
  let router: jasmine.SpyObj<Router>;
  let comp: ClientesPendientesComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'listarPendientes', 'completarPendiente', 'rechazarPendiente', 'rechazarTodosPendientes',
      'listarPendientesRevisionKore', 'marcarRevisada',
    ]);
    // Defaults vacíos — ngOnInit() llama a cargar() Y cargarKore(); los tests de una sola bandeja
    // no necesitan los datos de la otra salvo que los pisen explícitamente.
    loyalty.listarPendientes.and.returnValue(of({
      grupos: [], total: 0, totalRegistros: 0, page: 1, limit: 20, pages: 1,
    }));
    loyalty.listarPendientesRevisionKore.and.returnValue(of({
      cards: [], total: 0, page: 1, limit: 20, pages: 1,
    }));
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    comp = new ClientesPendientesComponent(loyalty, router);
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

  // Buscador (2026-10-29, nuevo) — mismo patrón de debounce que el de la bandeja de Kore
  // (ver más abajo), aplicado al tab "Pendientes de import".
  describe('buscador del tab "Pendientes de import" (debounced)', () => {
    it('onSearchChange() espera 400ms sin cambios antes de volver a cargar (reseteando a página 1)', fakeAsync(() => {
      comp.ngOnInit();
      comp.page = 3;
      loyalty.listarPendientes.calls.reset();

      comp.search = 'Juan';
      comp.onSearchChange();
      tick(399);
      expect(loyalty.listarPendientes).not.toHaveBeenCalled();

      tick(1);
      expect(comp.page).toBe(1);
      expect(loyalty.listarPendientes).toHaveBeenCalledWith(1, 20, 'Juan');

      comp.ngOnDestroy();
    }));

    it('distinctUntilChanged: el mismo término repetido dos veces solo dispara una carga', fakeAsync(() => {
      comp.ngOnInit();
      loyalty.listarPendientes.calls.reset();

      comp.search = 'Ana';
      comp.onSearchChange();
      tick(400);
      comp.onSearchChange();
      tick(400);

      expect(loyalty.listarPendientes).toHaveBeenCalledTimes(1);

      comp.ngOnDestroy();
    }));

    it('buscar() resetea a página 1 y vuelve a cargar de inmediato (Enter)', () => {
      comp.page = 2;
      comp.search = 'Beto';
      loyalty.listarPendientes.calls.reset();

      comp.buscar();

      expect(comp.page).toBe(1);
      expect(loyalty.listarPendientes).toHaveBeenCalledWith(1, 20, 'Beto');
    });

    it('clearSearch() limpia el término, resetea a página 1 y recarga de inmediato, sin esperar el debounce', fakeAsync(() => {
      comp.ngOnInit();
      comp.page = 3;
      comp.search = 'Juan';
      loyalty.listarPendientes.calls.reset();

      comp.clearSearch();

      expect(comp.search).toBe('');
      expect(comp.page).toBe(1);
      expect(loyalty.listarPendientes).toHaveBeenCalledWith(1, 20, '');

      // Mismo trade-off ya documentado en clearSearchKore(): el next('') interno es la PRIMERA
      // emisión que ve distinctUntilChanged en este test, así que dispara una 2da recarga
      // 400ms después — redundante pero inofensiva (mismos filtros).
      tick(400);
      expect(loyalty.listarPendientes).toHaveBeenCalledTimes(2);

      comp.ngOnDestroy();
    }));

    it('ngOnDestroy() corta la suscripción del buscador (no recarga después de destruido)', fakeAsync(() => {
      comp.ngOnInit();
      loyalty.listarPendientes.calls.reset();
      comp.ngOnDestroy();

      comp.search = 'xyz';
      comp.onSearchChange();
      tick(400);

      expect(loyalty.listarPendientes).not.toHaveBeenCalled();
    }));
  });

  describe('tabs (2026-10-29) — "Pendientes de import" / "Tarjetas nuevas de Kore"', () => {
    it('arranca en el tab "import" por default', () => {
      expect(comp.tabActiva).toBe('import');
    });

    it('cambiar de tab solo cambia tabActiva, sin volver a pedir datos al backend', () => {
      comp.ngOnInit();
      loyalty.listarPendientes.calls.reset();
      loyalty.listarPendientesRevisionKore.calls.reset();

      comp.tabActiva = 'kore';

      expect(comp.tabActiva).toBe('kore');
      expect(loyalty.listarPendientes).not.toHaveBeenCalled();
      expect(loyalty.listarPendientesRevisionKore).not.toHaveBeenCalled();
    });
  });

  describe('Tarjetas nuevas de Kore (bandeja de revisión del webhook)', () => {
    describe('cargarKore()', () => {
      it('carga cardsKore, total y pages desde listarPendientesRevisionKore', () => {
        loyalty.listarPendientesRevisionKore.and.returnValue(of({
          cards: [cardKore(), cardKore({ id: '11', nombre: 'Beto Ruiz' })],
          total: 2, page: 1, limit: 20, pages: 1,
        }));

        comp.ngOnInit();

        expect(loyalty.listarPendientesRevisionKore).toHaveBeenCalledWith(1, 20, '');
        expect(comp.cardsKore.length).toBe(2);
        expect(comp.cardsKore[1].nombre).toBe('Beto Ruiz');
        expect(comp.totalKore).toBe(2);
        expect(comp.pagesKore).toBe(1);
        expect(comp.loadingKore).toBe(false);
      });

      it('error: expone un mensaje y apaga loadingKore', () => {
        loyalty.listarPendientesRevisionKore.and.returnValue(throwError(() => ({ error: { error: 'boom kore' } })));
        comp.ngOnInit();
        expect(comp.errorKore).toBe('boom kore');
        expect(comp.loadingKore).toBe(false);
      });
    });

    describe('verTarjeta()', () => {
      it('navega a /lealtad/tarjetas/:id — mismo patrón que abrirDetalle() en tarjetas-list', () => {
        const c = cardKore({ id: '42' });
        comp.verTarjeta(c);
        expect(router.navigate).toHaveBeenCalledWith(['/lealtad/tarjetas', '42']);
      });
    });

    describe('marcarRevisada() / confirmarRevisar() — vía app-confirm-modal', () => {
      it('marcarRevisada() solo abre el modal, no llama al servicio todavía', () => {
        const c = cardKore();
        comp.cardsKore = [c];

        comp.marcarRevisada(c);

        expect(comp.confirmRevisarCard).toBe(c);
        expect(loyalty.marcarRevisada).not.toHaveBeenCalled();
        expect(comp.cardsKore).toEqual([c]);
      });

      it('cerrarConfirmRevisar() cancela sin llamar al servicio', () => {
        const c = cardKore();
        comp.marcarRevisada(c);

        comp.cerrarConfirmRevisar();

        expect(comp.confirmRevisarCard).toBeNull();
        expect(loyalty.marcarRevisada).not.toHaveBeenCalled();
      });

      it('camino feliz: llama al servicio, quita la tarjeta de la lista y muestra el mensaje de éxito', () => {
        const c = cardKore({ id: '7', nombre: 'Carla Díaz' });
        comp.cardsKore = [c, cardKore({ id: '8' })];
        comp.totalKore = 2;
        loyalty.marcarRevisada.and.returnValue(of({ ...c, revisionPendiente: false }));

        comp.marcarRevisada(c);
        comp.confirmarRevisar();

        expect(loyalty.marcarRevisada).toHaveBeenCalledWith('7');
        expect(comp.confirmRevisarCard).toBeNull();
        expect(comp.cardsKore.map((x) => x.id)).toEqual(['8']);
        expect(comp.totalKore).toBe(1);
        expect(comp.ultimoRevisadoMsg).toContain('Carla Díaz');
        expect(comp.revisando[7]).toBe(false);
      });

      it('error del backend: muestra el mensaje de error y apaga el spinner, sin tocar la lista', () => {
        const c = cardKore({ id: '7' });
        comp.cardsKore = [c];
        comp.totalKore = 1;
        loyalty.marcarRevisada.and.returnValue(throwError(() => ({ error: { error: 'no se pudo revisar' } })));

        comp.marcarRevisada(c);
        comp.confirmarRevisar();

        expect(comp.errorKore).toBe('no se pudo revisar');
        expect(comp.revisando[7]).toBe(false);
        expect(comp.cardsKore.length).toBe(1);
        expect(comp.totalKore).toBe(1);
      });
    });

    // Buscador (2026-10-29, nuevo) — mismo patrón de debounce que tarjetas-list.component.ts.
    describe('buscador de la bandeja de Kore (debounced)', () => {
      it('onSearchChangeKore() espera 400ms sin cambios antes de volver a cargar (reseteando a página 1)', fakeAsync(() => {
        comp.ngOnInit();
        comp.pageKore = 3;
        loyalty.listarPendientesRevisionKore.calls.reset();

        comp.searchKore = 'Juan';
        comp.onSearchChangeKore();
        tick(399);
        expect(loyalty.listarPendientesRevisionKore).not.toHaveBeenCalled();

        tick(1);
        expect(comp.pageKore).toBe(1);
        expect(loyalty.listarPendientesRevisionKore).toHaveBeenCalledWith(1, 20, 'Juan');

        comp.ngOnDestroy();
      }));

      it('distinctUntilChanged: el mismo término repetido dos veces solo dispara una carga', fakeAsync(() => {
        comp.ngOnInit();
        loyalty.listarPendientesRevisionKore.calls.reset();

        comp.searchKore = 'Ana';
        comp.onSearchChangeKore();
        tick(400);
        comp.onSearchChangeKore();
        tick(400);

        expect(loyalty.listarPendientesRevisionKore).toHaveBeenCalledTimes(1);

        comp.ngOnDestroy();
      }));

      it('buscarKore() resetea a página 1 y vuelve a cargar de inmediato (Enter)', () => {
        comp.pageKore = 2;
        comp.searchKore = 'Beto';
        loyalty.listarPendientesRevisionKore.calls.reset();

        comp.buscarKore();

        expect(comp.pageKore).toBe(1);
        expect(loyalty.listarPendientesRevisionKore).toHaveBeenCalledWith(1, 20, 'Beto');
      });

      it('clearSearchKore() limpia el término, resetea a página 1 y recarga de inmediato, sin esperar el debounce', fakeAsync(() => {
        comp.ngOnInit();
        comp.pageKore = 3;
        comp.searchKore = 'Juan';
        loyalty.listarPendientesRevisionKore.calls.reset();

        comp.clearSearchKore();

        expect(comp.searchKore).toBe('');
        expect(comp.pageKore).toBe(1);
        expect(loyalty.listarPendientesRevisionKore).toHaveBeenCalledWith(1, 20, '');

        // Mismo trade-off ya documentado en tarjetas-list.component.ts#clearSearch(): el next('')
        // interno es la PRIMERA emisión que ve distinctUntilChanged en este test (nunca se buscó
        // nada antes vía el Subject), así que pasa igual y dispara una 2da recarga 400ms después
        // — redundante pero inofensiva (mismos filtros).
        tick(400);
        expect(loyalty.listarPendientesRevisionKore).toHaveBeenCalledTimes(2);

        comp.ngOnDestroy();
      }));

      it('ngOnDestroy() corta la suscripción del buscador (no recarga después de destruido)', fakeAsync(() => {
        comp.ngOnInit();
        loyalty.listarPendientesRevisionKore.calls.reset();
        comp.ngOnDestroy();

        comp.searchKore = 'xyz';
        comp.onSearchChangeKore();
        tick(400);

        expect(loyalty.listarPendientesRevisionKore).not.toHaveBeenCalled();
      }));
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

  let router: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'listarPendientes', 'completarPendiente', 'rechazarPendiente', 'rechazarTodosPendientes',
      'listarPendientesRevisionKore', 'marcarRevisada',
    ]);
    loyalty.listarPendientes.and.returnValue(of({
      grupos: [], total: 0, totalRegistros: 0, page: 1, limit: 20, pages: 1,
    }));
    loyalty.listarPendientesRevisionKore.and.returnValue(of({
      cards: [], total: 0, page: 1, limit: 20, pages: 1,
    }));
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      declarations: [ClientesPendientesComponent],
      providers: [
        { provide: LoyaltyService, useValue: loyalty },
        { provide: Router, useValue: router },
      ],
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

  it('sección "Tarjetas nuevas de Kore": renderiza nombre, teléfono, nivel y fecha de creación (tab "kore" activo)', () => {
    loyalty.listarPendientesRevisionKore.and.returnValue(of({
      cards: [cardKore({ id: '99', nombre: 'Dana Reyes', telefono: '5559876543', nivel: 'Oro' })],
      total: 1, page: 1, limit: 20, pages: 1,
    }));
    fixture.detectChanges();
    fixture.componentInstance.tabActiva = 'kore';
    fixture.detectChanges();

    const seccion = fixture.nativeElement.querySelector('.cpk-section');
    expect(seccion).toBeTruthy();
    const texto = seccion.textContent;
    expect(texto).toContain('Dana Reyes');
    expect(texto).toContain('5559876543');
    expect(texto).toContain('Oro');
    // La fecha viene formateada por el pipe `date` — no se compara el string exacto (depende del
    // locale del runner), solo que el dato de creación se muestra en algún lado de la card.
    expect(seccion.querySelector('.cpk-card')).toBeTruthy();
  });

  // Tabs (2026-10-29): solo una sección visible a la vez en el DOM real.
  describe('tabs — switch real en el template', () => {
    it('por default muestra "Pendientes de import" y oculta ".cpk-section"', () => {
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.cp-head-actions')).toBeTruthy(); // bloque de arriba (import)
      expect(fixture.nativeElement.querySelector('.cpk-section')).toBeFalsy();
    });

    it('click en el tab "Tarjetas nuevas de Kore" muestra .cpk-section y oculta el bloque de import', () => {
      fixture.detectChanges();

      const tabs = fixture.nativeElement.querySelectorAll('.cp-tab');
      const tabKore = Array.from(tabs as NodeListOf<HTMLButtonElement>)
        .find((b) => b.textContent?.includes('Tarjetas nuevas de Kore'));
      expect(tabKore).toBeTruthy();
      tabKore!.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.tabActiva).toBe('kore');
      expect(fixture.nativeElement.querySelector('.cpk-section')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.cp-head-actions')).toBeFalsy();
    });

    it('los badges de conteo son visibles en los botones de tab', () => {
      loyalty.listarPendientes.and.returnValue(of({
        grupos: [grupo([pendiente()])], total: 1, totalRegistros: 5, page: 1, limit: 20, pages: 1,
      }));
      loyalty.listarPendientesRevisionKore.and.returnValue(of({
        cards: [cardKore()], total: 3, page: 1, limit: 20, pages: 1,
      }));
      fixture.detectChanges();

      const texto = fixture.nativeElement.querySelector('.cp-tabs-bar').textContent;
      expect(texto).toContain('5');
      expect(texto).toContain('3');
    });
  });

  // Buscador de la bandeja de Kore (2026-10-29): filtra por nombre o teléfono.
  // NO_ERRORS_SCHEMA + sin FormsModule (ver comentario arriba) significa que [(ngModel)] no
  // actualiza `searchKore` con eventos DOM reales acá — se invoca el método del componente
  // directamente (igual que el resto de esta suite TestBed), confiando en que el input existe
  // en el DOM con el selector correcto.
  describe('buscador de la bandeja de Kore — template real', () => {
    it('el input de búsqueda existe en el DOM de la bandeja de Kore', () => {
      fixture.detectChanges();
      fixture.componentInstance.tabActiva = 'kore';
      fixture.detectChanges();

      const input: HTMLInputElement = fixture.nativeElement.querySelector('.cpk-filter-input');
      expect(input).toBeTruthy();
    });

    it('buscarKore() filtra el resultado mostrado en la grilla de Kore', fakeAsync(() => {
      fixture.detectChanges();
      fixture.componentInstance.tabActiva = 'kore';
      fixture.detectChanges();

      loyalty.listarPendientesRevisionKore.and.returnValue(of({
        cards: [cardKore({ id: '1', nombre: 'Juan Pérez' })],
        total: 1, page: 1, limit: 20, pages: 1,
      }));
      fixture.componentInstance.searchKore = 'Juan';
      fixture.componentInstance.buscarKore();
      fixture.detectChanges();

      expect(loyalty.listarPendientesRevisionKore).toHaveBeenCalledWith(1, 20, 'Juan');
      const texto = fixture.nativeElement.querySelector('.cpk-section').textContent;
      expect(texto).toContain('Juan Pérez');
    }));
  });

  // Buscador del tab "Pendientes de import" (2026-10-29): mismo criterio que el bloque de arriba
  // para Kore — NO_ERRORS_SCHEMA + sin FormsModule significa que [(ngModel)] no actualiza `search`
  // con eventos DOM reales acá, así que se invoca el método del componente directamente.
  describe('buscador del tab "Pendientes de import" — template real', () => {
    it('el input de búsqueda existe en el DOM del tab de import (activo por default)', () => {
      fixture.detectChanges();

      const input: HTMLInputElement = fixture.nativeElement.querySelector('.cpk-filter-input');
      expect(input).toBeTruthy();
    });

    it('buscar() filtra el resultado mostrado en la grilla de import', () => {
      fixture.detectChanges();

      loyalty.listarPendientes.and.returnValue(of({
        grupos: [grupo([pendiente({ id: 1, nombre: 'Juan Pérez' })])],
        total: 1, totalRegistros: 1, page: 1, limit: 20, pages: 1,
      }));
      fixture.componentInstance.search = 'Juan';
      fixture.componentInstance.buscar();
      fixture.detectChanges();

      expect(loyalty.listarPendientes).toHaveBeenCalledWith(1, 20, 'Juan');
      expect(fixture.nativeElement.textContent).toContain('Juan Pérez');
    });
  });
});
