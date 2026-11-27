import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { TarjetasListComponent } from './tarjetas-list.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { AuthService } from '../../../core/services/auth.service';
import { SocketService, LealtadClienteKoreActualizadoEvent } from '../../../core/services/socket.service';
import { LoyaltyCardListResult } from '../../../core/models/loyalty.model';

// Notificación en vivo (2026-11-17, bug real: la lista no se refrescaba sola cuando el webhook de
// clientes de Kore activaba/desactivaba una tarjeta) — mismo patrón de stub que
// tarjeta-detail.component.spec.ts#crearSocketSpy (objeto plano, no jasmine.createSpyObj:
// `lealtadClienteKoreActualizado$` es una propiedad `readonly`, no un método espiable).
function crearSocketSpy() {
  const lealtadClienteKoreActualizado$ = new Subject<LealtadClienteKoreActualizadoEvent>();
  return { lealtadClienteKoreActualizado$ };
}

/**
 * RED (PR6, task 6.2-6.3) — la UI real (búsqueda, filtros, tabla) no existe
 * todavía, el placeholder de PR5 solo tiene un <p> estático.
 */
const FIXTURE: LoyaltyCardListResult = {
  cards: [
    { id: '1', telefono: '5512345678', nombre: 'Juan Pérez', nivel: 'Bronce', saldoPuntos: 0, activa: true },
    { id: '2', telefono: '5598765432', nombre: 'Ana López', nivel: 'Plata', saldoPuntos: 340.5, activa: false },
  ],
  total: 2, page: 1, limit: 20, pages: 1,
};

// Origen (2026-10-27): una tarjeta creada por el webhook de catálogo de clientes de Kore, misma
// forma que persiste loyalty-kore-cliente.service.js (backend).
const FIXTURE_CON_ORIGEN: LoyaltyCardListResult = {
  cards: [
    { id: '1', telefono: '5512345678', nombre: 'Juan Pérez', nivel: 'Bronce', saldoPuntos: 0, activa: true, createdById: 'kore-webhook', createdByNombre: 'Kore (webhook catálogo)' },
    { id: '2', telefono: '5598765432', nombre: 'Ana López', nivel: 'Plata', saldoPuntos: 340.5, activa: false, createdById: 'user-1', createdByNombre: 'Alguien' },
  ],
  total: 2, page: 1, limit: 20, pages: 1,
};

describe('TarjetasListComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<TarjetasListComponent>;
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(async () => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listar', 'listarNivelesKore']);
    loyalty.listar.and.returnValue(of(FIXTURE));
    // Catálogo real de niveles Kore (2026-11-17) — reemplaza el filtro hardcodeado
    // Bronce/Plata/Oro, ver tarjetas-list.component.ts#_cargarNivelesCatalogo().
    loyalty.listarNivelesKore.and.returnValue(of([]));
    const authStub = { hasPermission: () => true };

    await TestBed.configureTestingModule({
      imports: [RouterModule.forRoot([])],
      declarations: [TarjetasListComponent],
      providers: [
        { provide: LoyaltyService, useValue: loyalty },
        { provide: AuthService, useValue: authStub },
        { provide: SocketService, useValue: crearSocketSpy() },
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

  // Rename de terminología UI (2026-11-23, pedido explícito del usuario): "Nivel" → "Categoría"
  // en el texto visible del encabezado de la tabla y del filtro — los identificadores internos
  // (sortBy 'nivel', nivelFiltro, LoyaltyNivel, etc.) no cambian, ver tarjetas-list.component.html.
  it('muestra "Categoría" (no "Nivel") como encabezado de la tabla y como opción por defecto del filtro', () => {
    fixture.detectChanges();

    const headers: HTMLElement[] = fixture.nativeElement.querySelectorAll('.tl-th-sortable');
    const headerNivel = headers[2];
    expect(headerNivel.textContent).toContain('Categoría');
    expect(headerNivel.textContent).not.toContain('Nivel');

    const nivelSelect: HTMLSelectElement = fixture.nativeElement.querySelector('.tl-filter-select');
    expect(nivelSelect.options[0].textContent).toBe('Todas las categorías');
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
    expect(headers.length).toBe(6); // Teléfono, Nombre, Nivel, Saldo, Estatus, Creada
    headers[3].click(); // Saldo
    fixture.detectChanges();

    expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ sort: 'saldo', sortDir: 'ASC' }));
    const arrows = fixture.nativeElement.querySelectorAll('.tl-sort-arrow--active');
    expect(arrows.length).toBe(1);
  });

  it('click en el header "Creada" ordena por createdAt (compilador real)', () => {
    fixture.detectChanges();
    loyalty.listar.calls.reset();

    const headers: HTMLElement[] = fixture.nativeElement.querySelectorAll('.tl-th-sortable');
    headers[5].click(); // Creada
    fixture.detectChanges();

    expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ sort: 'creado', sortDir: 'ASC' }));
  });

  it('muestra el badge "Kore" solo en tarjetas creadas por el webhook (compilador real)', () => {
    loyalty.listar.and.returnValue(of(FIXTURE_CON_ORIGEN));
    fixture.detectChanges();

    const badges: HTMLElement[] = fixture.nativeElement.querySelectorAll('.tl-badge--kore');
    expect(badges.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Kore');
  });

  it('el filtro de origen se manda a listar() al buscar (compilador real)', () => {
    fixture.detectChanges();
    loyalty.listar.calls.reset();

    fixture.componentInstance.origenFiltro = 'kore';
    fixture.detectChanges();
    const btn: HTMLElement = fixture.nativeElement.querySelector('.tl-filter-btn');
    btn.click();

    expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ origen: 'kore' }));
  });

  it('el filtro de nivel sale del catálogo real de Kore, no de un set fijo (compilador real)', () => {
    loyalty.listarNivelesKore.and.returnValue(of([
      { id: 1, koreId: 'k1', nombre: 'Bronce', porcentaje: 1, color: null, esInicial: true, activo: true },
      { id: 2, koreId: 'k2', nombre: 'Esmeralda', porcentaje: 10, color: null, esInicial: false, activo: true },
    ]));
    fixture.detectChanges();

    expect(loyalty.listarNivelesKore).toHaveBeenCalledWith(true);
    const nivelSelect: HTMLSelectElement = fixture.nativeElement.querySelector('.tl-filter-select');
    const valores = Array.from(nivelSelect.querySelectorAll('option')).map((o: any) => o.value);
    expect(valores).toContain('Esmeralda');
  });

  // Chip de nivel con color real de Kore (2026-11-17) — reemplaza los 3 modificadores CSS fijos
  // (.tl-tier--bronce/plata/oro), que dejaban sin color cualquier nivel nuevo no hardcodeado.
  it('pinta el chip de nivel con el color real de Kore cuando el catálogo lo trae (compilador real)', () => {
    loyalty.listarNivelesKore.and.returnValue(of([
      { id: 1, koreId: 'k1', nombre: 'Bronce', porcentaje: 1, color: '#CD7F32', esInicial: true, activo: true },
      { id: 2, koreId: 'k2', nombre: 'Plata', porcentaje: 2, color: null, esInicial: false, activo: true },
    ]));
    fixture.detectChanges();

    const chips: HTMLElement[] = fixture.nativeElement.querySelectorAll('.tl-tier');
    // FIXTURE.cards[0].nivel === 'Bronce' → color conocido del catálogo
    expect(chips[0].style.background.toLowerCase()).toContain('205, 127, 50'); // #CD7F32
    // FIXTURE.cards[1].nivel === 'Plata' → sin color en catálogo → fallback neutro
    expect(chips[1].style.background.toLowerCase()).toContain('229, 231, 235'); // #e5e7eb
  });

  it('colorDeNivel(): cae al fallback neutro si el nivel no existe en el catálogo', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.colorDeNivel('NivelInexistente')).toEqual({
      background: '#e5e7eb', color: '#374151',
    });
  });

  it('el botón de limpiar búsqueda solo aparece con texto escrito (compilador real)', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tl-filter-clear')).toBeNull();

    fixture.componentInstance.search = 'abc';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tl-filter-clear')).not.toBeNull();
  });

  describe('Panel de Reportes (2026-10-29)', () => {
    it('arranca cerrado, sin backdrop', () => {
      fixture.detectChanges();
      expect(fixture.componentInstance.showReportesPanel).toBe(false);
      expect(fixture.nativeElement.querySelector('.report-sidebar-backdrop')).toBeNull();
    });

    it('el botón "Reportes" del header abre el panel (compilador real)', () => {
      fixture.detectChanges();
      const btn: HTMLElement = Array.from(fixture.nativeElement.querySelectorAll('.tl-head-actions .btn-ghost'))
        .find((el) => (el as HTMLElement).textContent?.includes('Reportes')) as HTMLElement;
      expect(btn).toBeTruthy();

      btn.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.showReportesPanel).toBe(true);
      expect(fixture.nativeElement.querySelector('.report-sidebar-backdrop')).not.toBeNull();
    });

    it('el backdrop cierra el panel al hacer click', () => {
      fixture.componentInstance.showReportesPanel = true;
      fixture.detectChanges();

      const backdrop: HTMLElement = fixture.nativeElement.querySelector('.report-sidebar-backdrop');
      backdrop.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.showReportesPanel).toBe(false);
    });
  });
});

describe('TarjetasListComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let socket: ReturnType<typeof crearSocketSpy>;
  let comp: TarjetasListComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listar', 'listarNivelesKore']);
    loyalty.listar.and.returnValue(of(FIXTURE));
    loyalty.listarNivelesKore.and.returnValue(of([]));
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    auth.hasPermission.and.returnValue(true);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    socket = crearSocketSpy();
    comp = new TarjetasListComponent(loyalty, auth, router, socket as unknown as SocketService);
  });

  it('ngOnInit(): loads cards from the service and exposes them', () => {
    comp.ngOnInit();
    expect(comp.cards).toEqual(FIXTURE.cards);
    expect(comp.loading).toBe(false);
  });

  // Bug real 2026-11-17: el webhook de catálogo de clientes de Kore (activar/desactivar/
  // actualizar) nunca refrescaba esta lista — había que recargar la página a mano.
  it('se refresca sola cuando llega lealtad-cliente-kore:actualizado, preservando página/filtros', () => {
    comp.ngOnInit();
    loyalty.listar.calls.reset();
    comp.page = 2;
    comp.nivelFiltro = 'Oro';

    socket.lealtadClienteKoreActualizado$.next({ cardId: 'c1' });

    expect(loyalty.listar).toHaveBeenCalledTimes(1);
    expect(loyalty.listar).toHaveBeenCalledWith(jasmine.objectContaining({ page: 2, nivel: 'Oro' }));
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

  describe('colorDeNivel() — color real de Kore en el chip de nivel (2026-11-17)', () => {
    it('usa el color del catálogo como fondo y calcula el texto por contraste (claro → texto oscuro)', () => {
      loyalty.listarNivelesKore.and.returnValue(of([
        { id: 1, koreId: 'k1', nombre: 'Oro', porcentaje: 2.5, color: '#E6DF0A', esInicial: false, activo: true },
      ]));
      comp.ngOnInit();

      expect(comp.colorDeNivel('Oro')).toEqual({ background: '#E6DF0A', color: '#1f2937' });
    });

    it('color oscuro → texto claro', () => {
      loyalty.listarNivelesKore.and.returnValue(of([
        { id: 1, koreId: 'k1', nombre: 'Azul', porcentaje: 1, color: '#1E88E5', esInicial: false, activo: true },
      ]));
      comp.ngOnInit();

      expect(comp.colorDeNivel('Azul')).toEqual({ background: '#1E88E5', color: '#ffffff' });
    });

    it('nivel en catálogo pero sin color (null) → fallback neutro', () => {
      loyalty.listarNivelesKore.and.returnValue(of([
        { id: 1, koreId: 'k1', nombre: 'Bronce', porcentaje: 1, color: null, esInicial: false, activo: true },
      ]));
      comp.ngOnInit();

      expect(comp.colorDeNivel('Bronce')).toEqual({ background: '#e5e7eb', color: '#374151' });
    });

    it('nivel que no existe en el catálogo → fallback neutro, nunca sin estilo', () => {
      comp.ngOnInit();
      expect(comp.colorDeNivel('NivelInexistente')).toEqual({ background: '#e5e7eb', color: '#374151' });
    });
  });

  it('esOrigenKore(): true solo cuando createdById es el actor sintético del webhook', () => {
    expect(comp.esOrigenKore({ createdById: 'kore-webhook' } as any)).toBe(true);
    expect(comp.esOrigenKore({ createdById: 'user-1' } as any)).toBe(false);
    expect(comp.esOrigenKore({ createdById: null } as any)).toBe(false);
    expect(comp.esOrigenKore({} as any)).toBe(false);
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

  // Limpieza de UI (2026-11-04, el Sistema de Lealtad deja de usar NIP como mecanismo de
  // autenticación de clientes): crear una tarjeta ya NO revela el NIP generado al staff.
  it('onTarjetaCreada(): cierra el modal de creación y recarga la lista, sin revelar el NIP', () => {
    comp.showCreateModal = true;
    comp.onTarjetaCreada({ card: FIXTURE.cards[0], nip: '1234' });
    expect(comp.showCreateModal).toBe(false);
    expect(loyalty.listar).toHaveBeenCalled();
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
