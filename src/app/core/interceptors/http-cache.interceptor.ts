import { Injectable } from '@angular/core';
import {
  HttpInterceptor, HttpRequest, HttpHandler,
  HttpResponse, HttpEvent,
} from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CacheService } from '../services/cache.service';

const NO_CACHE_PATTERNS = ['/auth/', '/upload', '/import-excel', '/batch', '/compare', '/drive/', '/sat/descarga-manual/status/', '/sat/limites/', '/banks/', '/erp/', '/polizas'];

const TTL_MAP: Array<[string, number]> = [
  ['/periodos-fiscales', 300],   // 5 min — cambia poco
  ['/comparisons/periodos', 120], // 2 min
  ['/comparisons/stats', 60],
  ['/reports/dashboard', 60],
  ['/discrepancies/summary', 30],
  ['/cfdis', 30],
  ['/comparisons', 30],
  ['/discrepancies', 30],
];

@Injectable()
export class HttpCacheInterceptor implements HttpInterceptor {

  constructor(private cache: CacheService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (req.method !== 'GET') return next.handle(req);
    if (NO_CACHE_PATTERNS.some(p => req.urlWithParams.includes(p))) return next.handle(req);

    // Peticiones de sesiones individuales no se cachean (son el mecanismo de polling)
    if (/\/sessions\/[^/]+$/.test(req.urlWithParams)) return next.handle(req);

    const cached = this.cache.get<HttpResponse<unknown>>(req.urlWithParams);
    if (cached) return of(cached.clone());

    return next.handle(req).pipe(
      tap(event => {
        if (event instanceof HttpResponse && event.status === 200) {
          const ttl = this.resolveTTL(req.urlWithParams);
          this.cache.set(req.urlWithParams, event.clone(), ttl);
        }
      }),
    );
  }

  private resolveTTL(url: string): number {
    for (const [pattern, ttl] of TTL_MAP) {
      if (url.includes(pattern)) return ttl;
    }
    return 60;
  }
}
