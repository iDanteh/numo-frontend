import { NgModule }                                        from '@angular/core';
import { BrowserModule }                                   from '@angular/platform-browser';
import { CommonModule }                                    from '@angular/common';
import { HTTP_INTERCEPTORS, HttpClientModule }             from '@angular/common/http';
import { AuthModule, AuthHttpInterceptor }                 from '@auth0/auth0-angular';

import { AppRoutingModule }  from './app-routing.module';
import { AppComponent }      from './app.component';
import { LoginComponent }    from './features/login/login.component';
import { LayoutModule }      from './layouts/layout.module';
import { environment }       from '../environments/environment';
import { RateLimitInterceptor } from './core/interceptors/rate-limit.interceptor';
import { HttpCacheInterceptor } from './core/interceptors/http-cache.interceptor';

@NgModule({
  declarations: [AppComponent, LoginComponent],
  imports: [
    BrowserModule,
    CommonModule,
    HttpClientModule,
    AppRoutingModule,
    LayoutModule,
    AuthModule.forRoot({
      domain:   environment.auth0.domain,
      clientId: environment.auth0.clientId,
      authorizationParams: {
        redirect_uri: environment.appUrl,
        audience:     environment.auth0.audience,
      },
      httpInterceptor: {
        allowedList: [
          {
            uriMatcher: (uri) => uri.startsWith(environment.apiUrl),
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
