import { TestBed, ComponentFixture } from '@angular/core/testing';
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
});

describe('TarjetasListComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let comp: TarjetasListComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', ['listar', 'cambiarNip']);
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

  it('onTarjetaCreada(): cierra el modal de creación y recarga la lista', () => {
    comp.showCreateModal = true;
    comp.onTarjetaCreada({ card: FIXTURE.cards[0], nip: '1234' });
    expect(comp.showCreateModal).toBe(false);
    expect(loyalty.listar).toHaveBeenCalled();
    expect(comp.nipRecienCreado).toEqual({ nombre: 'Juan Pérez', nip: '1234' });
  });
});
