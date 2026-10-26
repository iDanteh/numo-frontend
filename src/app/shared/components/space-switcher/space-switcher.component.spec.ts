import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  LucideDynamicIcon,
  provideLucideIcons,
  LucideChevronDown,
  LucideLayoutDashboard,
  LucideCreditCard,
  LucideArrowLeftRight,
  LucideReceiptText,
} from '@lucide/angular';
import { SpaceSwitcherComponent } from './space-switcher.component';
import { AuthService } from '../../../core/services/auth.service';
import { TransitionOverlayService } from '../transition-overlay/transition-overlay.service';
import { EspaciosService } from '../../../core/services/espacios.service';

describe('SpaceSwitcherComponent', () => {
  let fixture: ComponentFixture<SpaceSwitcherComponent>;
  let component: SpaceSwitcherComponent;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let overlay: jasmine.SpyObj<TransitionOverlayService>;
  let espacios: jasmine.SpyObj<EspaciosService>;

  beforeEach(async () => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission', 'getLandingPage']);
    router = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    overlay = jasmine.createSpyObj<TransitionOverlayService>('TransitionOverlayService', ['play']);
    espacios = jasmine.createSpyObj<EspaciosService>('EspaciosService', ['pase', 'irA']);
    auth.hasPermission.and.returnValue(false);
    overlay.play.and.returnValue(Promise.resolve());
    router.navigateByUrl.and.returnValue(Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [LucideDynamicIcon],
      declarations: [SpaceSwitcherComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
        { provide: TransitionOverlayService, useValue: overlay },
        { provide: EspaciosService, useValue: espacios },
        provideLucideIcons(LucideChevronDown, LucideLayoutDashboard, LucideCreditCard, LucideArrowLeftRight, LucideReceiptText),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SpaceSwitcherComponent);
    component = fixture.componentInstance;
    component.currentSpaceId = 'numo';
    fixture.detectChanges();
  });

  it('filters out Lealtad when the user lacks loyalty:read (permission filtering)', () => {
    auth.hasPermission.and.returnValue(false);
    expect(component.visibleSpaces.map(s => s.id)).toEqual(['numo']);
  });

  it('shows Lealtad when the user has loyalty:read', () => {
    auth.hasPermission.and.callFake((p: string) => p === 'loyalty:read');
    expect(component.visibleSpaces.map(s => s.id)).toEqual(['numo', 'lealtad']);
  });

  it('shows Kiosco de facturación only with kiosco:admin', () => {
    auth.hasPermission.and.callFake((p: string) => p === 'kiosco:admin');
    expect(component.visibleSpaces.map(s => s.id)).toEqual(['numo', 'kiosco']);
  });

  it('selecting Kiosco asks NUMO for a pase and leaves to its url (no transition, no router)', async () => {
    auth.hasPermission.and.returnValue(true);
    const url = 'https://kiosko-pruebas.tubosyconexiones.mx/admin/login#pase=a.b.c';
    espacios.pase.and.returnValue(Promise.resolve(url));

    await component.select(component.visibleSpaces.find(s => s.id === 'kiosco')!);

    expect(espacios.pase).toHaveBeenCalledWith('/espacios/kiosco/pase');
    expect(espacios.irA).toHaveBeenCalledWith(url);
    expect(overlay.play).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('if the Kiosco pase fails, shows an error, stays in NUMO and lets the user retry', async () => {
    auth.hasPermission.and.returnValue(true);
    espacios.pase.and.returnValue(Promise.reject(new Error('503')));

    await component.select(component.visibleSpaces.find(s => s.id === 'kiosco')!);

    expect(espacios.irA).not.toHaveBeenCalled();
    expect(component.errorEspacio).toContain('Kiosco de facturación');
    expect(component.abriendo).toBeNull();
  });

  it('marks the current space and selecting it is a no-op (not clickable/navigable to itself)', async () => {
    auth.hasPermission.and.returnValue(true);
    const numoSpace = component.visibleSpaces.find(s => s.id === 'numo')!;
    expect(component.isCurrent(numoSpace)).toBe(true);

    await component.select(numoSpace);

    expect(overlay.play).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('selecting a non-current space plays its transition BEFORE navigating to its route', async () => {
    auth.hasPermission.and.returnValue(true);
    const callOrder: string[] = [];
    overlay.play.and.callFake((v: any) => { callOrder.push(`play:${v}`); return Promise.resolve(); });
    router.navigateByUrl.and.callFake((url: any) => { callOrder.push(`nav:${url}`); return Promise.resolve(true); });

    const lealtadSpace = component.visibleSpaces.find(s => s.id === 'lealtad')!;
    await component.select(lealtadSpace);

    expect(overlay.play).toHaveBeenCalledWith('to-lealtad');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/lealtad');
    expect(callOrder).toEqual(['play:to-lealtad', 'nav:/lealtad']);
  });

  it('selecting Numo resolves its route dynamically via AuthService.getLandingPage()', async () => {
    component.currentSpaceId = 'lealtad';
    auth.hasPermission.and.returnValue(true);
    auth.getLandingPage.and.returnValue('/banks');

    const numoSpace = component.visibleSpaces.find(s => s.id === 'numo')!;
    await component.select(numoSpace);

    expect(overlay.play).toHaveBeenCalledWith('to-numo');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/banks');
  });

  it('panel marks the current space with a check icon (not the old "Actual" text badge) and resolves its accent-based background/check color', () => {
    auth.hasPermission.and.returnValue(true);
    component.toggle();
    fixture.detectChanges();

    const items: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.ssw__item'));
    const currentItem = items[0]; // 'numo' is currentSpaceId in this suite's beforeEach
    expect(currentItem.querySelector('.ssw__item-check')).not.toBeNull();
    expect(currentItem.textContent).not.toContain('Actual');

    const numoSpace = component.visibleSpaces.find(s => s.id === 'numo')!;
    expect(component.rowBackground(numoSpace)).toBe('rgba(79, 70, 229, 0.2)');
    expect(component.checkColor(numoSpace)).toBe('#fff');

    const lealtadSpace = component.visibleSpaces.find(s => s.id === 'lealtad')!;
    expect(component.rowBackground(lealtadSpace)).toBe('');
    expect(component.checkColor(lealtadSpace)).toBe('#fbbf24');
  });

  it('toggle(): opens and closes the menu', () => {
    expect(component.open).toBe(false);
    component.toggle();
    expect(component.open).toBe(true);
    component.toggle();
    expect(component.open).toBe(false);
  });

  it('click outside the component closes the open menu', () => {
    component.toggle();
    expect(component.open).toBe(true);

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    component.onDocumentClick({ target: outside } as unknown as MouseEvent);

    expect(component.open).toBe(false);
    outside.remove();
  });

  it('click inside the component does NOT close the menu', () => {
    component.toggle();
    component.onDocumentClick({ target: fixture.nativeElement } as unknown as MouseEvent);
    expect(component.open).toBe(true);
  });

  it('Escape closes the open menu', () => {
    component.toggle();
    expect(component.open).toBe(true);
    component.onEscape();
    expect(component.open).toBe(false);
  });

  it('trigger shows the image + "Puntos y recompensas" subtitle for Lealtad — NOT the generic arrow icon or "NUMO" text (bug fix regression guard)', () => {
    component.currentSpaceId = 'lealtad';
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.ssw__trigger');
    const img = trigger.querySelector('.ssw__logo-icon') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('MaestroBetoGrande.png');
    expect(trigger.querySelector('.ssw__logo-icon--svg')).toBeNull();

    expect(trigger.querySelector('.ssw__logo-name').textContent.trim()).toBe('Lealtad');
    expect(trigger.querySelector('.ssw__logo-sub').textContent.trim()).toBe('Puntos y recompensas');
    expect(trigger.textContent).not.toContain('NUMO');
  });

  it('currentSpace getter resolves the Space entry matching currentSpaceId', () => {
    component.currentSpaceId = 'lealtad';
    expect(component.currentSpace?.id).toBe('lealtad');

    component.currentSpaceId = 'numo';
    expect(component.currentSpace?.id).toBe('numo');
  });

  it('ArrowDown/Enter on the panel selects the highlighted non-current space', async () => {
    auth.hasPermission.and.callFake((p: string) => p === 'loyalty:read');
    const callOrder: string[] = [];
    overlay.play.and.callFake((v: any) => { callOrder.push(`play:${v}`); return Promise.resolve(); });

    component.toggle();
    fixture.detectChanges();

    component.onMenuKeydown({ key: 'ArrowDown', preventDefault: () => {} } as unknown as KeyboardEvent);
    expect(component.activeIndex).toBe(0); // 'numo' — el espacio actual, sigue siendo navegable con flechas aunque no sea clickeable

    component.onMenuKeydown({ key: 'ArrowDown', preventDefault: () => {} } as unknown as KeyboardEvent);
    expect(component.activeIndex).toBe(1); // 'lealtad'

    component.onMenuKeydown({ key: 'Enter', preventDefault: () => {} } as unknown as KeyboardEvent);

    expect(overlay.play).toHaveBeenCalledWith('to-lealtad');
  });
});
