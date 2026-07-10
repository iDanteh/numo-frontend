import { NgModule }     from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard }       from './core/guards/auth.guard';
import { RoleGuard }       from './core/guards/role.guard';
import { PermissionGuard } from './core/guards/permission.guard';
import { LoginComponent }        from './features/login/login.component';
import { UnauthorizedComponent } from './features/unauthorized/unauthorized.component';
import { LandingComponent }      from './features/landing/landing.component';

const routes: Routes = [
  // Ruta pública — vista de login
  { path: 'login', component: LoginComponent },

  // Página de acceso denegado
  { path: 'unauthorized', component: UnauthorizedComponent },

  // Rutas protegidas
  // Ruta raíz — antes redirigía siempre a /banks; ahora LandingComponent
  // resuelve a la primera sección para la que el usuario tenga permiso (ver
  // AuthService.getLandingPage()), así un rol tienda (sin banks:read) no cae
  // en /unauthorized por default. A propósito NO es un guard (canActivate) —
  // ver el comentario en landing.component.ts (NG0200 por dependencia
  // circular con Router si se resuelve como guard en esta ruta).
  { path: '', pathMatch: 'full', component: LandingComponent },
  {
    path: 'banks',
    canActivate: [AuthGuard, PermissionGuard],
    data: { permissions: ['banks:read'] },
    loadChildren: () => import('./features/banks/banks.module').then(m => m.BanksModule),
  },
  {
    path: 'account-plan',
    canActivate: [AuthGuard, PermissionGuard],
    data: { permissions: ['account-plan:read'] },
    loadChildren: () => import('./features/account-plan/account-plan.module').then(m => m.AccountPlanModule),
  },
  {
    path: 'collection-requests',
    canActivate: [AuthGuard, PermissionGuard],
    data: { permissions: ['collections:read'] },
    loadChildren: () => import('./features/collection-requests/collection-request.module').then(m => m.CollectionRequestModule),
  },
  {
    path: 'users',
    canActivate: [AuthGuard, PermissionGuard],
    data: { permissions: ['users:manage'] },
    loadChildren: () => import('./features/users/users.module').then(m => m.UsersModule),
  },
  {
    path: 'dashboard',
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/dashboard/dashboard.module').then(m => m.DashboardModule),
  },
  {
    path: 'cfdis',
    canActivate: [AuthGuard, PermissionGuard],
    data: { permissions: ['visor:read'] },
    loadChildren: () => import('./features/cfdis/cfdis.module').then(m => m.CfdisModule),
  },
  {
    path: 'sat',
    canActivate: [AuthGuard, PermissionGuard],
    data: { permissions: ['visor:sat'] },
    loadChildren: () => import('./features/sat/sat.module').then(m => m.SatModule),
  },
  {
    path: 'import',
    canActivate: [AuthGuard, PermissionGuard],
    data: { permissions: ['erp:manage'] },
    loadChildren: () => import('./features/import/import.module').then(m => m.ImportModule),
  },
  {
    path: 'ejercicios',
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/ejercicios/ejercicios.module').then(m => m.EjerciciosModule),
  },
  {
    path: 'entities',
    canActivate: [AuthGuard, PermissionGuard],
    data: { permissions: ['entities:write'] },
    loadChildren: () => import('./features/entities/entities.module').then(m => m.EntitiesModule),
  },
  {
    path: 'polizas',
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/polizas/polizas.module').then(m => m.PolizasModule),
  },
  {
    path: 'reportes',
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/reportes/reportes.module').then(m => m.ReportesModule),
  },
  // Mismo criterio que la ruta raíz — sin esto, una URL no encontrada también
  // caía siempre en /banks sin importar el permiso del usuario.
  { path: '**', component: LandingComponent },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
