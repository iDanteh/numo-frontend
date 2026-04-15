import { Component } from '@angular/core';
import { AuthService } from './core/services/auth.service';

@Component({
  standalone:  false,
  selector:    'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  constructor(public auth: AuthService) {}
}
