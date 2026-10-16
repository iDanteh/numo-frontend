import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LealtadConsultaComponent } from './lealtad-consulta.component';

/**
 * Módulo lazy separado del staff LealtadModule — SIN guard, registrado
 * ANTES de /lealtad en app-routing.module.ts (D14/mismo precedente que
 * login/unauthorized/LandingComponent). FormsModule es necesario acá para
 * [(ngModel)] en el formulario de celular/NIP (PR7) — no es ambiente como
 * CommonModule (ver nota en apply-progress de PR6).
 */
@NgModule({
  declarations: [LealtadConsultaComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: LealtadConsultaComponent }]),
  ],
})
export class LealtadPublicModule {}
