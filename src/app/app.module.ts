import { NgModule }                                        from '@angular/core';
import { BrowserModule }                                   from '@angular/platform-browser';
import { CommonModule }                                    from '@angular/common';
import { HTTP_INTERCEPTORS, HttpClientModule }             from '@angular/common/http';
import { AuthModule, AuthHttpInterceptor }                 from '@auth0/auth0-angular';

import { AppRoutingModule }        from './app-routing.module';
import { AppComponent }            from './app.component';
import { LoginComponent }          from './features/login/login.component';
import { UnauthorizedComponent }   from './features/unauthorized/unauthorized.component';
import { LandingComponent }        from './features/landing/landing.component';
import { LayoutModule }      from './layouts/layout.module';
import { SharedModule }      from './shared/shared.module';
import { environment }       from '../environments/environment';
import { RateLimitInterceptor } from './core/interceptors/rate-limit.interceptor';
import { HttpCacheInterceptor } from './core/interceptors/http-cache.interceptor';

/**
 * Lógica pura del uriMatcher de AuthHttpInterceptor, extraída para poder
 * probarla sola (una arrow function inline dentro del decorador @NgModule no
 * es testeable en aislamiento) — mismo criterio que
 * buildIdentificarPayload() en collection-request.component.ts.
 *
 * D13: excluye '/loyalty/public/' — hoy TODA llamada a apiUrl pide un token;
 * sin esto la consulta pública anónima intentaría mandar un Bearer y
 * fallaría (no hay sesión que lo provea).
 */
export function isCacheableApiUri(uri: string, apiUrl: string): boolean {
  return uri.startsWith(apiUrl) && !uri.startsWith(apiUrl + '/loyalty/public/');
}

@NgModule({
  declarations: [AppComponent, LoginComponent, UnauthorizedComponent, LandingComponent],
  imports: [
    BrowserModule,
    CommonModule,
    HttpClientModule,
    AppRoutingModule,
    LayoutModule,
    SharedModule,
    AuthModule.forRoot({
      domain:           environment.auth0.domain,
      clientId:         environment.auth0.clientId,
      useRefreshTokens: true,
      cacheLocation:    'localstorage',
      authorizationParams: {
        redirect_uri: window.location.origin,
        audience:     environment.auth0.audience,
      },
      httpInterceptor: {
        allowedList: [
          {
            uriMatcher: (uri) => isCacheableApiUri(uri, environment.apiUrl),
            tokenOptions: {
              authorizationParams: { audience: environment.auth0.audience },
            },
          },
        ],
      },
    }),
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthHttpInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: HttpCacheInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: RateLimitInterceptor, multi: true },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
