import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PermissionGuard } from '../../core/guards/permission.guard';
import { LealtadShellComponent } from './shell/lealtad-shell.component';
import { TarjetasListComponent } from './tarjetas/tarjetas-list.component';
import { TarjetaDetailComponent } from './tarjetas/tarjeta-detail.component';
import { LealtadConfigComponent } from './configuracion/lealtad-config.component';

// Shape calcada de polizas.module.ts (multi-ruta vía forChild), NO el patrón
// de una sola ruta de banks.module.ts — ver loyalty-shell-ui/spec.md
// ("mirroring the polizas.module.ts pattern"). El guard de /lealtad
// (loyalty:read) ya corre en app-routing.module.ts antes de llegar acá;
// 'configuracion' agrega su propio PermissionGuard porque loyalty:config es
// un permiso más estricto que loyalty:read.
const routes: Routes = [
  {
    path: '',
    component: LealtadShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'tarjetas' },
      { path: 'tarjetas', component: TarjetasListComponent },
      { path: 'tarjetas/:id', component: TarjetaDetailComponent },
      {
        path: 'configuracion',
        component: LealtadConfigComponent,
        canActivate: [PermissionGuard],
        data: { permissions: ['loyalty:config'] },
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class LealtadRoutingModule {}
