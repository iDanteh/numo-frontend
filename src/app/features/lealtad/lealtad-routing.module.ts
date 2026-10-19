import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { PermissionGuard } from '../../core/guards/permission.guard';
import { LealtadShellComponent } from './shell/lealtad-shell.component';
import { TarjetasListComponent } from './tarjetas/tarjetas-list.component';
import { TarjetaDetailComponent } from './tarjetas/tarjeta-detail.component';
import { ImportarClientesComponent } from './importar-clientes/importar-clientes.component';
import { ClientesPendientesComponent } from './clientes-pendientes/clientes-pendientes.component';

// Shape calcada de polizas.module.ts (multi-ruta vía forChild), NO el patrón
// de una sola ruta de banks.module.ts — ver loyalty-shell-ui/spec.md
// ("mirroring the polizas.module.ts pattern"). El guard de /lealtad
// (loyalty:read) ya corre en app-routing.module.ts antes de llegar acá.
//
// 'users'/'entities'/'config'/'system-monitor' — 2026-10-16: rutas hijas
// nuevas bajo ESTE MISMO padre (LealtadShellComponent) que reutilizan
// (loadChildren) EXACTAMENTE los mismos módulos que app-routing.module.ts
// monta para esas 4 secciones de "Administración", con el mismo guard y los
// mismos permisos (NO son permisos nuevos). Fix al bug real: antes el
// sidebar de Lealtad linkeaba directo a las rutas absolutas (/users, etc.),
// y como LealtadShellComponent es el padre de las rutas hijas de Lealtad
// (se destruye al salir de /lealtad/**) y AppComponent decide el shell
// puramente por el path, el usuario "rebotaba" al shell global de Numo al
// entrar a Administración desde Lealtad. Ahora quedan accesibles como
// /lealtad/users, /lealtad/entities, /lealtad/config, /lealtad/system-monitor
// — mismo segmento final que las rutas absolutas en administracion-nav.config.ts,
// así el sidebar de Lealtad solo necesita prefijar '/lealtad' (ver
// lealtad-shell.component.ts). "Configuración de Lealtad" ya NO vive acá
// como ruta propia — ver config-admin.component.ts, ahora embebida dentro
// de "Configuraciones Globales" (/config → /lealtad/config), gateada
// igual por loyalty:config (D10 sigue vigente, solo cambió dónde vive la UI).
const routes: Routes = [
  {
    path: '',
    component: LealtadShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'tarjetas' },
      { path: 'tarjetas', component: TarjetasListComponent },
      { path: 'tarjetas/:id', component: TarjetaDetailComponent },
      {
        // Migración de clientes legados ("Club Tuberos") — permiso angosto y
        // exclusivo de admin (loyalty:importar), distinto de loyalty:read que
        // ya gatea el resto de este shell — por eso lleva su propio guard acá,
        // mismo criterio que 'users'/'entities'/'config'/'system-monitor'.
        path: 'importar-clientes',
        canActivate: [AuthGuard, PermissionGuard],
        data: { permissions: ['loyalty:importar'] },
        component: ImportarClientesComponent,
      },
      {
        // Clientes legados sin teléfono (loyalty_pending_enrollments, decisión
        // de negocio 2026-10-19) — mismo permiso que importar-clientes, es
        // parte del mismo flujo de migración.
        path: 'clientes-pendientes',
        canActivate: [AuthGuard, PermissionGuard],
        data: { permissions: ['loyalty:importar'] },
        component: ClientesPendientesComponent,
      },
      {
        path: 'users',
        canActivate: [AuthGuard, PermissionGuard],
        data: { permissions: ['users:manage'] },
        loadChildren: () => import('../users/users.module').then(m => m.UsersModule),
      },
      {
        path: 'entities',
        canActivate: [AuthGuard, PermissionGuard],
        data: { permissions: ['entities:read'] },
        loadChildren: () => import('../entities/entities.module').then(m => m.EntitiesModule),
      },
      {
        path: 'config',
        canActivate: [AuthGuard, PermissionGuard],
        // 'loyalty:config' habilita entrar solo para ver/editar la sección de Lealtad embebida
        // (ConfigAdminComponent la gatea aparte con showLealtad()); no da acceso al resto del catálogo.
        data: { permissions: ['config:manage', 'loyalty:config'] },
        loadChildren: () => import('../config-admin/config-admin.module').then(m => m.ConfigAdminModule),
      },
      {
        path: 'system-monitor',
        canActivate: [AuthGuard, PermissionGuard],
        data: { permissions: ['system:monitor:read'] },
        loadChildren: () => import('../system-monitor/system-monitor.module').then(m => m.SystemMonitorModule),
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class LealtadRoutingModule {}
