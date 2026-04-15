import { Component, OnInit } from '@angular/core';
import { Router }            from '@angular/router';
import { filter, switchMap, take } from 'rxjs/operators';
import { AuthService }       from '../../core/services/auth.service';

@Component({
  standalone:   false,
  selector:     'app-login',
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit {
  loading = false;
  readonly currentYear = new Date().getFullYear();

  constructor(
    private auth:   AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    // Si ya hay sesión activa, ir directo a la app
    this.auth.isLoading$.pipe(
      filter(loading => !loading),
      take(1),
      switchMap(() => this.auth.isAuthenticated$),
      take(1),
    ).subscribe(isAuth => {
      if (isAuth) this.router.navigate(['/banks']);
    });
  }

  login(): void {
    this.loading = true;
    this.auth.login(); // Redirige a Auth0 Universal Login (no retorna)
  }
}
