import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '../../../shared/shared.module';
import { LealtadConfigComponent } from './lealtad-config.component';

// 2026-10-16 — módulo propio y chico: LealtadConfigComponent dejó de tener
// su ruta standalone (/lealtad/configuracion) y ahora se embebe dentro de
// ConfigAdminComponent ("Central de configuración", ver
// config-admin.component.html, sección "Lealtad" del rail). Un componente
// Angular clásico (no standalone) no puede declararse en dos NgModules a la
// vez — antes vivía en LealtadModule, que ya no lo necesita porque la ruta
// que lo montaba fue eliminada (ver lealtad-routing.module.ts). Este módulo
// lo exporta para que ConfigAdminModule pueda incrustarlo por selector
// (<app-lealtad-config>) sin reescribir su lógica de negocio.
@NgModule({
  declarations: [LealtadConfigComponent],
  // SharedModule (2026-10-20): necesario para <app-date-range-popover> en la
  // sección Promociones — antes solo traía CommonModule/FormsModule porque
  // ningún control de este componente lo necesitaba.
  imports: [CommonModule, FormsModule, SharedModule],
  exports: [LealtadConfigComponent],
})
export class LealtadConfigModule {}
