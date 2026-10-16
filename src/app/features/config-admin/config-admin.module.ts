import { NgModule }      from '@angular/core';
import { CommonModule }  from '@angular/common';
import { FormsModule }   from '@angular/forms';
import { RouterModule }  from '@angular/router';

import { ConfigAdminComponent } from './config-admin.component';
// 2026-10-16 — "Central de configuración" centraliza acá los 3 bloques de
// negocio de Lealtad (% por nivel, catálogo de motivos, flags de sucursal),
// gateados específicamente por loyalty:config (NO por el config:manage
// genérico del resto de esta pantalla — decisión explícita del usuario).
// Reusa el componente existente por selector en vez de reescribir su lógica.
import { LealtadConfigModule } from '../lealtad/configuracion/lealtad-config.module';

@NgModule({
  declarations: [ConfigAdminComponent],
  imports: [
    CommonModule,
    FormsModule,
    LealtadConfigModule,
    RouterModule.forChild([{ path: '', component: ConfigAdminComponent }]),
  ],
})
export class ConfigAdminModule {}
