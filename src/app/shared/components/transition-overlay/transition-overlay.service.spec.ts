import { TestBed } from '@angular/core/testing';
import { TransitionOverlayService } from './transition-overlay.service';

describe('TransitionOverlayService', () => {
  let service: TransitionOverlayService;
  let matchMediaSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TransitionOverlayService);
  });

  afterEach(() => {
    if (matchMediaSpy) matchMediaSpy.and.callThrough();
  });

  function stubReducedMotion(matches: boolean): void {
    matchMediaSpy = spyOn(window, 'matchMedia').and.returnValue({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      addListener: () => {},
      removeListener: () => {},
    } as unknown as MediaQueryList);
  }

  it('play() emits the requested variant on variant$ so the overlay component can render it', () => {
    stubReducedMotion(false);
    const seen: Array<string | null> = [];
    service.variant$.subscribe(v => seen.push(v));

    service.play('to-lealtad');

    expect(seen).toEqual([null, 'to-lealtad']);
  });

  it('play() with the OTHER variant emits that exact variant — proves it is not hardcoded', () => {
    stubReducedMotion(false);
    const seen: Array<string | null> = [];
    service.variant$.subscribe(v => seen.push(v));

    service.play('to-numo');

    expect(seen).toEqual([null, 'to-numo']);
  });

  it('complete() resolves the pending play() promise and clears variant$ back to null', async () => {
    stubReducedMotion(false);
    const seen: Array<string | null> = [];
    service.variant$.subscribe(v => seen.push(v));

    const pending = service.play('to-lealtad');
    service.complete();
    await pending;

    expect(seen).toEqual([null, 'to-lealtad', null]);
  });

  it('respects prefers-reduced-motion: resolves immediately and never emits a variant', async () => {
    stubReducedMotion(true);
    const seen: Array<string | null> = [];
    service.variant$.subscribe(v => seen.push(v));

    await service.play('to-lealtad');

    expect(seen).toEqual([null]); // never switched to 'to-lealtad'
  });

  it('with mantener, complete() resolves play() but keeps the curtain on until cerrar()', async () => {
    stubReducedMotion(false);
    const seen: Array<string | null> = [];
    service.variant$.subscribe(v => seen.push(v));

    const done = service.play('to-kiosco', { mantener: true });
    service.complete();
    await done;
    expect(seen).toEqual([null, 'to-kiosco']);

    service.cerrar();
    expect(seen).toEqual([null, 'to-kiosco', null]);
  });
});
