import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LealtadConsultaComponent } from './lealtad-consulta.component';
import { RecuperarNipComponent } from './recuperar-nip/recuperar-nip.component';

/**
 * Módulo lazy separado del staff LealtadModule — SIN guard, registrado
 * ANTES de /lealtad en app-routing.module.ts (D14/mismo precedente que
 * login/unauthorized/LandingComponent). FormsModule es necesario acá para
 * [(ngModel)] en el formulario de celular/NIP (PR7) — no es ambiente como
 * CommonModule (ver nota en apply-progress de PR6).
 *
 * 'recuperar' (2026-10-20): recuperación de NIP en 2 pasos, mismo módulo
 * público/sin guard — comparte router/declarations con la consulta porque es
 * la misma superficie anónima de cara al cliente final (D13/D14).
 */
@NgModule({
  declarations: [LealtadConsultaComponent, RecuperarNipComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      { path: '', component: LealtadConsultaComponent },
      { path: 'recuperar', component: RecuperarNipComponent },
    ]),
  ],
})
export class LealtadPublicModule {}
