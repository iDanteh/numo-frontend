import { NgModule }     from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard }       from './core/guards/auth.guard';
import { RoleGuard }       from './core/guards/role.guard';
import { PermissionGuard } from './core/guards/permission.guard';
import { LoginComponent } from './features/login/login.component';

const routes: Routes = [
  // Ruta pública — vista de login
  { path: 'login', component: LoginComponent },

  // Rutas protegidas
  { path: '', redirectTo: '/banks', pathMatch: 'full' },
  {
    path: 'banks',
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/banks/banks.module').then(m => m.BanksModule),
  },
  {
    path: 'account-plan',
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/account-plan/account-plan.module').then(m => m.AccountPlanModule),
  },
  {
    path: 'collection-requests',
    canActivate: [AuthGuard],
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
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/cfdis/cfdis.module').then(m => m.CfdisModule),
  },
  {
    path: 'sat',
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/sat/sat.module').then(m => m.SatModule),
  },
  {
    path: 'import',
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/import/import.module').then(m => m.ImportModule),
  },
  {
    path: 'ejercicios',
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/ejercicios/ejercicios.module').then(m => m.EjerciciosModule),
  },
  { path: '**', redirectTo: '/banks' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
