import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LealtadConsultaComponent } from './lealtad-consulta.component';

/**
 * Módulo lazy separado del staff LealtadModule — SIN guard, registrado
 * ANTES de /lealtad en app-routing.module.ts (D14/mismo precedente que
 * login/unauthorized/LandingComponent). La UI real (inputs Celular/NIP,
 * error genérico 422) llega en PR7 — ver TarjetasConsultaComponent.
 */
@NgModule({
  declarations: [LealtadConsultaComponent],
  imports: [
    CommonModule,
    RouterModule.forChild([{ path: '', component: LealtadConsultaComponent }]),
  ],
})
export class LealtadPublicModule {}
