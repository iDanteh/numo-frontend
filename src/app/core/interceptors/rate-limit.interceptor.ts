import { Injectable } from '@angular/core';
import {
  HttpInterceptor, HttpRequest, HttpHandler,
  HttpEvent, HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable()
export class RateLimitInterceptor implements HttpInterceptor {

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 429) {
          const retryAfter: number = err.error?.retryAfter || 60;
          if (!environment.production) {
            console.warn(`[429] Rate limit alcanzado. Espera ${retryAfter}s antes de reintentar.`);
          }
          // No reintentamos aquí: un retry sin pasar por AuthInterceptor iría sin token.
          // El componente recibe el error y muestra su propio mensaje.
        }
        return throwError(() => err);
      }),
    );
  }
}
