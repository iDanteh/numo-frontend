import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { EjerciciosComponent } from './ejercicios.component';

@NgModule({
  declarations: [EjerciciosComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      { path: '', component: EjerciciosComponent },
    ]),
  ],
})
export class EjerciciosModule {}
