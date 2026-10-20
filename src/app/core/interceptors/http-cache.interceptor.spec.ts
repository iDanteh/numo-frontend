import { HttpRequest, HttpResponse, HttpHandler } from '@angular/common/http';
import { of } from 'rxjs';
import { HttpCacheInterceptor } from './http-cache.interceptor';
import { CacheService } from '../services/cache.service';

// Approval test (existing file) + RED for the new pattern: '/loyalty/' must
// join NO_CACHE_PATTERNS (same bug class as '/banks/'/'/config/' —
// sistema-lealtad's config:updated-driven % refresh would otherwise serve a
// stale GET for up to 60s, same reasoning documented in the file's own header
// comment).
describe('HttpCacheInterceptor — sistema-lealtad: /loyalty/ never cached', () => {
  let cache: CacheService;
  let interceptor: HttpCacheInterceptor;
  let handlerCalls: number;
  const handler: HttpHandler = {
    handle: (req: HttpRequest<unknown>) => {
      handlerCalls++;
      return of(new HttpResponse({ status: 200, body: { ok: true } }));
    },
  };

  beforeEach(() => {
    cache = new CacheService();
    interceptor = new HttpCacheInterceptor(cache);
    handlerCalls = 0;
  });

  it('a GET to /api/cfdis IS still cacheable (approval — pre-existing TTL_MAP pattern untouched)', done => {
    const req = new HttpRequest('GET', '/api/cfdis');
    interceptor.intercept(req, handler).subscribe(() => {
      expect(cache.get(req.urlWithParams)).toBeTruthy();
      done();
    });
  });

  it('a GET to /api/loyalty/config is NEVER cached — always hits the real handler, even called twice', done => {
    const req = new HttpRequest('GET', '/api/loyalty/config');
    interceptor.intercept(req, handler).subscribe(() => {
      interceptor.intercept(req, handler).subscribe(() => {
        expect(handlerCalls).toBe(2); // would be 1 if the 2nd call hit the cache
        expect(cache.get(req.urlWithParams)).toBeNull();
        done();
      });
    });
  });

  it('a GET to /api/loyalty/public/consulta is NEVER cached either (public route, same pattern match)', done => {
    const req = new HttpRequest('GET', '/api/loyalty/public/consulta');
    interceptor.intercept(req, handler).subscribe(() => {
      expect(cache.get(req.urlWithParams)).toBeNull();
      done();
    });
  });
});
