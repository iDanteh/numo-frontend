import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LealtadConsultaComponent } from './lealtad-consulta.component';

/**
 * Módulo lazy separado del staff LealtadModule — SIN guard, registrado
 * ANTES de /lealtad en app-routing.module.ts (D14/mismo precedente que
 * login/unauthorized/LandingComponent). FormsModule es necesario acá para
 * [(ngModel)] en el formulario de celular/código (PR7) — no es ambiente como
 * CommonModule (ver nota en apply-progress de PR6).
 *
 * 'recuperar' (recuperación de NIP en 2 pasos) se eliminó 2026-10-26: quedó
 * huérfana al reemplazar el NIP por el flujo OTP en la consulta pública — el
 * NIP ya es de uso exclusivo interno de staff, ningún cliente final lo
 * necesita. Ver memoria project_lealtad_consulta_publica_otp.
 */
@NgModule({
  declarations: [LealtadConsultaComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      { path: '', component: LealtadConsultaComponent },
    ]),
  ],
})
export class LealtadPublicModule {}
