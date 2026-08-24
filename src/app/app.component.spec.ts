import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterModule } from '@angular/router';
import { AuthModule } from '@auth0/auth0-angular';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterModule.forRoot([]),
        // AppComponent inyecta AuthService (@auth0/auth0-angular), que a su vez
        // depende de HttpClient — sin AuthModule.forRoot() + HttpClientTestingModule
        // la inyección falla con NullInjectorError. domain/clientId dummy y
        // HttpClientTestingModule: no se hace login real ni llamadas de red.
        HttpClientTestingModule,
        AuthModule.forRoot({ domain: 'ci-dummy.auth0.com', clientId: 'ci-dummy-client-id' }),
      ],
      declarations: [
        AppComponent
      ],
      // El template real usa componentes de SharedModule (ej. app-toast) que
      // este test no necesita renderizar — solo importa que AppComponent se
      // instancie sin explotar.
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
