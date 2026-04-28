import { Component } from '@angular/core';
import { Location }  from '@angular/common';

@Component({
  standalone: false,
  selector:   'app-unauthorized',
  templateUrl: './unauthorized.component.html',
})
export class UnauthorizedComponent {
  constructor(private location: Location) {}

  goBack(): void {
    this.location.back();
  }
}
