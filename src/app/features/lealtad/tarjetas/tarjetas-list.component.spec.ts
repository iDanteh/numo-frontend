import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TarjetasListComponent } from './tarjetas-list.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { AuthService } from '../../../core/services/auth.service';
import { LoyaltyCardListResult } from '../../../core/models/loyalty.model';

/**
 * RED (PR6, task 6.2-6.3) — la UI real (búsqueda, filtros, tabla) no existe
 * todavía, el placeholder de PR5 solo tiene un <p> estático.
 */
const FIXTURE: LoyaltyCardListResult = {
  cards: [
    { id: 1, telefono: '5512345678', nombre: 'Juan Pérez', nivel: 'Bronce', saldoPuntos: 0, activa: true },
    { id: 2, telefono: '5598765432', nombre: 'Ana López', nivel: 'Plata', saldoPuntos: 340.5, activa: false },
  ],
  total: 2, page: 1, limit: 20, pages: 1,
};

describe('TarjetasListComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<TarjetasListComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listar']);
    loyalty.listar.and.returnValue(of(FIXTURE));
    const authStub = { hasPermission: () => true };

    await TestBed.configureTestingModule({
      imports: [RouterModule.forRoot([])],
      declarations: [TarjetasListComponent],
      providers: [
        { provide: LoyaltyService, useValue: loyalty },
        { provide: AuthService, useValue: authStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(TarjetasListComponent);
  });

  it('renders the loaded cards in the table (phone, nombre, nivel, saldo)', () => {
    expect(() => fixture.detectChanges()).not.toThrow();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('5512345678');
    expect(text).toContain('Juan Pérez');
    expect(text).toContain('Ana López');
  });

  it('shows "+ Nueva tarjeta" only when loyalty:tarjetas:crear is granted', () => {
    const authNoPerm = TestBed.inject(AuthService) as any;
    authNoPerm.hasPermission = () => false;
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Nueva tarjeta');
  });

  it('click en un header ordenable dispara una nueva consulta con sort/sortDir reales (compilador real, no solo lógica)', () => {
    fixture.detectChanges();
    loyalty.listar.calls.reset();

    const headers: HTMLElement[] = fixture.nativeElement.querySelectorAll('.tl-th-sortable');
    expect(headers.length).toBe(5); // Teléfono, Nombre, Nivel, Saldo, Estatus
    headers[3].click(); // Saldo
    fixture.detectChanges();

    expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ sort: 'saldo', sortDir: 'ASC' }));
    const arrows = fixture.nativeElement.querySelectorAll('.tl-sort-arrow--active');
    expect(arrows.length).toBe(1);
  });

  it('el botón de limpiar búsqueda solo aparece con texto escrito (compilador real)', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tl-filter-clear')).toBeNull();

    fixture.componentInstance.search = 'abc';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tl-filter-clear')).not.toBeNull();
  });
});

describe('TarjetasListComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let comp: TarjetasListComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listar', 'cambiarNip', 'editarTarjeta']);
    loyalty.listar.and.returnValue(of(FIXTURE));
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    auth.hasPermission.and.returnValue(true);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    comp = new TarjetasListComponent(loyalty, auth, router);
  });

  it('ngOnInit(): loads cards from the service and exposes them', () => {
    comp.ngOnInit();
    expect(comp.cards).toEqual(FIXTURE.cards);
    expect(comp.loading).toBe(false);
  });

  it('buscar(): resets to page 1 and re-queries with the current filters', () => {
    comp.ngOnInit();
    comp.page = 3;
    comp.search = '5598';
    comp.nivelFiltro = 'Plata';
    comp.buscar();
    expect(comp.page).toBe(1);
    expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({
      search: '5598', nivel: 'Plata', page: 1,
    }));
  });

  it('canCrear(): reflects loyalty:tarjetas:crear', () => {
    auth.hasPermission.and.callFake((p: string) => p === 'loyalty:tarjetas:crear');
    expect(comp.canCrear()).toBe(true);
    auth.hasPermission.and.returnValue(false);
    expect(comp.canCrear()).toBe(false);
  });

  it('abrirDetalle(): navega a /lealtad/tarjetas/:id', () => {
    comp.abrirDetalle({ id: 7 } as any);
    expect(router.navigate).toHaveBeenCalledWith(['/lealtad/tarjetas', 7]);
  });

  describe('canCambiarNip() / cambiarNip() — acción rápida nueva (2026-10-19)', () => {
    it('canCambiarNip(): refleja loyalty:tarjetas:editar', () => {
      auth.hasPermission.and.callFake((p: string) => p === 'loyalty:tarjetas:editar');
      expect(comp.canCambiarNip()).toBe(true);
      auth.hasPermission.and.returnValue(false);
      expect(comp.canCambiarNip()).toBe(false);
    });

    it('pedirCambiarNip(): pide confirmación antes de llamar al servicio', () => {
      comp.pedirCambiarNip(FIXTURE.cards[0]);
      expect(comp.confirmNipCard).toEqual(FIXTURE.cards[0]);
      expect(loyalty.cambiarNip).not.toHaveBeenCalled();
    });

    it('cerrarConfirmNip(): cancela sin llamar al servicio', () => {
      comp.confirmNipCard = FIXTURE.cards[0];
      comp.cerrarConfirmNip();
      expect(comp.confirmNipCard).toBeNull();
      expect(loyalty.cambiarNip).not.toHaveBeenCalled();
    });

    it('confirmarCambiarNip(): revela el NIP nuevo en su propio campo (nipCambiado), sin pisar nipRecienCreado', () => {
      loyalty.cambiarNip.and.returnValue(of({ nip: '7788' }));
      comp.nipRecienCreado = { nombre: 'Otro', nip: '0000' };
      comp.confirmNipCard = FIXTURE.cards[0];

      comp.confirmarCambiarNip();

      expect(loyalty.cambiarNip).toHaveBeenCalledWith(1);
      expect(comp.confirmNipCard).toBeNull();
      expect(comp.nipCambiandoId).toBeNull();
      expect(comp.nipCambiado).toEqual({ nombre: 'Juan Pérez', nip: '7788' });
      expect(comp.nipRecienCreado).toEqual({ nombre: 'Otro', nip: '0000' }); // no se tocó
    });

    it('confirmarCambiarNip(): en error, limpia el loading y muestra un mensaje', () => {
      loyalty.cambiarNip.and.returnValue(throwError(() => ({ error: { error: 'Server error' } })));
      comp.confirmNipCard = FIXTURE.cards[0];

      comp.confirmarCambiarNip();

      expect(comp.nipCambiandoId).toBeNull();
      expect(comp.nipError).toBe('Server error');
      expect(comp.nipCambiado).toBeNull();
    });

    it('cerrarNipCambiado(): limpia el campo de revelado', () => {
      comp.nipCambiado = { nombre: 'Juan Pérez', nip: '7788' };
      comp.cerrarNipCambiado();
      expect(comp.nipCambiado).toBeNull();
    });
  });

  describe('pedirToggleActiva() / confirmarDesactivar() — activar/desactivar rápido (2026-10-20)', () => {
    it('pedirToggleActiva(): tarjeta activa → pide confirmación, no llama al servicio todavía', () => {
      comp.pedirToggleActiva(FIXTURE.cards[0]); // activa: true
      expect(comp.confirmDesactivarCard).toEqual(FIXTURE.cards[0]);
      expect(loyalty.editarTarjeta).not.toHaveBeenCalled();
    });

    it('pedirToggleActiva(): tarjeta inactiva → reactiva directo, sin modal', () => {
      loyalty.editarTarjeta.and.returnValue(of({ ...FIXTURE.cards[1], activa: true }));
      comp.pedirToggleActiva(FIXTURE.cards[1]); // activa: false

      expect(comp.confirmDesactivarCard).toBeNull();
      expect(loyalty.editarTarjeta).toHaveBeenCalledWith(2, { activa: true });
    });

    it('cerrarConfirmDesactivar(): cancela sin llamar al servicio', () => {
      comp.confirmDesactivarCard = FIXTURE.cards[0];
      comp.cerrarConfirmDesactivar();
      expect(comp.confirmDesactivarCard).toBeNull();
      expect(loyalty.editarTarjeta).not.toHaveBeenCalled();
    });

    it('confirmarDesactivar(): llama al servicio con activa:false y actualiza la tarjeta en la lista', () => {
      const card = { ...FIXTURE.cards[0] }; // activa: true
      loyalty.editarTarjeta.and.returnValue(of({ ...card, activa: false }));
      comp.confirmDesactivarCard = card;

      comp.confirmarDesactivar();

      expect(loyalty.editarTarjeta).toHaveBeenCalledWith(1, { activa: false });
      expect(comp.confirmDesactivarCard).toBeNull();
      expect(comp.activaCambiandoId).toBeNull();
      expect(card.activa).toBe(false);
    });

    it('en error: limpia el loading y muestra un mensaje, sin tocar el estatus de la tarjeta', () => {
      const card = { ...FIXTURE.cards[0] };
      loyalty.editarTarjeta.and.returnValue(throwError(() => ({ error: { error: 'Server error' } })));
      comp.confirmDesactivarCard = card;

      comp.confirmarDesactivar();

      expect(comp.activaCambiandoId).toBeNull();
      expect(comp.activaError).toBe('Server error');
      expect(card.activa).toBe(true);
    });
  });

  it('onTarjetaCreada(): cierra el modal de creación y recarga la lista', () => {
    comp.showCreateModal = true;
    comp.onTarjetaCreada({ card: FIXTURE.cards[0], nip: '1234' });
    expect(comp.showCreateModal).toBe(false);
    expect(loyalty.listar).toHaveBeenCalled();
    expect(comp.nipRecienCreado).toEqual({ nombre: 'Juan Pérez', nip: '1234' });
  });

  describe('Búsqueda dinámica (debounce, 2026-10-20)', () => {
    it('onSearchChange(): espera 400ms sin tecla antes de volver a consultar', fakeAsync(() => {
      comp.ngOnInit(); // 1 llamada inicial a listar()
      loyalty.listar.calls.reset();

      comp.search = 'abc';
      comp.onSearchChange();
      tick(399);
      expect(loyalty.listar).not.toHaveBeenCalled();

      tick(1);
      expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ search: 'abc', page: 1 }));
      expect(comp.page).toBe(1);

      comp.ngOnDestroy();
    }));

    it('onSearchChange(): distinctUntilChanged — no repite la consulta si el término no cambió', fakeAsync(() => {
      comp.ngOnInit();
      loyalty.listar.calls.reset();

      comp.search = 'abc';
      comp.onSearchChange();
      tick(400);
      expect(loyalty.listar).toHaveBeenCalledTimes(1);

      comp.onSearchChange(); // mismo valor 'abc'
      tick(400);
      expect(loyalty.listar).toHaveBeenCalledTimes(1);

      comp.ngOnDestroy();
    }));

    it('clearSearch(): limpia y recarga de inmediato, sin esperar el debounce', fakeAsync(() => {
      comp.ngOnInit();
      comp.search = 'abc';
      loyalty.listar.calls.reset();

      comp.clearSearch();

      expect(comp.search).toBe('');
      expect(comp.page).toBe(1);
      expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ search: undefined, page: 1 }));

      // Mismo trade-off ya presente en collection-request.component.ts#clearSearch():
      // el next('') interno es la PRIMERA emisión que ve distinctUntilChanged en este
      // test (nunca se buscó nada antes vía el Subject), así que pasa igual y dispara
      // una 2da recarga 400ms después — redundante pero inofensiva (mismos filtros).
      tick(400);
      expect(loyalty.listar).toHaveBeenCalledTimes(2);

      comp.ngOnDestroy();
    }));

    it('ngOnDestroy(): corta la suscripción del buscador (no recarga después de destruido)', fakeAsync(() => {
      comp.ngOnInit();
      loyalty.listar.calls.reset();
      comp.ngOnDestroy();

      comp.search = 'xyz';
      comp.onSearchChange();
      tick(400);

      expect(loyalty.listar).not.toHaveBeenCalled();
    }));
  });

  describe('ordenarPor() — columnas ordenables (2026-10-20)', () => {
    it('primer click en una columna: ordena ASC y vuelve a página 1', () => {
      comp.ngOnInit();
      comp.page = 3;
      loyalty.listar.calls.reset();

      comp.ordenarPor('saldo');

      expect(comp.sortBy).toBe('saldo');
      expect(comp.sortDir).toBe('ASC');
      expect(comp.page).toBe(1);
      expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ sort: 'saldo', sortDir: 'ASC', page: 1 }));
    });

    it('segundo click en la MISMA columna: alterna a DESC', () => {
      comp.ngOnInit();
      comp.ordenarPor('nombre');
      loyalty.listar.calls.reset();

      comp.ordenarPor('nombre');

      expect(comp.sortDir).toBe('DESC');
      expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ sort: 'nombre', sortDir: 'DESC' }));
    });

    it('click en una columna DISTINTA: reinicia a ASC en la nueva columna', () => {
      comp.ngOnInit();
      comp.ordenarPor('nombre');
      comp.ordenarPor('nombre'); // ahora DESC
      loyalty.listar.calls.reset();

      comp.ordenarPor('nivel');

      expect(comp.sortBy).toBe('nivel');
      expect(comp.sortDir).toBe('ASC');
      expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ sort: 'nivel', sortDir: 'ASC' }));
    });

    it('al cargar sin interacción: ordena por saldo DESC (default pedido por el usuario — más puntos primero)', () => {
      comp.ngOnInit();
      expect(comp.sortBy).toBe('saldo');
      expect(comp.sortDir).toBe('DESC');
      expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ sort: 'saldo', sortDir: 'DESC' }));
    });
  });
});
