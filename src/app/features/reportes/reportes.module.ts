import { NgModule }           from '@angular/core';
import { CommonModule }       from '@angular/common';
import { RouterModule }       from '@angular/router';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { ReportesHubComponent }  from './reportes-hub.component';
import { PagosBancoComponent }   from './pagos-banco/pagos-banco.component';
import { DepositoIngresosComponent } from './depositos-ingresos/deposito-ingresos.component';
import { SugerenciasConciliacionPanelComponent } from './pagos-banco/components/sugerencias-conciliacion-panel/sugerencias-conciliacion-panel.component';
import { CierreMesComponent } from './cierre-mes/cierre-mes.component';
import { PorFacturarComponent } from './por-facturar/por-facturar.component';
import { PermissionGuard } from '../../core/guards/permission.guard';

// Cada reporte exige su permiso: "Por facturar" tiene uno propio y asignable
// por rol (2026-10-23, pedido del usuario); los demás siguen con visor:reports.
const VISOR_REPORTS = { canActivate: [PermissionGuard], data: { permissions: ['visor:reports'] } };

@NgModule({
  declarations: [ReportesHubComponent, PagosBancoComponent, DepositoIngresosComponent, SugerenciasConciliacionPanelComponent, CierreMesComponent, PorFacturarComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild([
      { path: '',                  component: ReportesHubComponent },
      { path: 'pagos-banco',       component: PagosBancoComponent, ...VISOR_REPORTS },
      { path: 'depositos-ingresos', component: DepositoIngresosComponent, ...VISOR_REPORTS },
      { path: 'cierre-de-mes',     component: CierreMesComponent, ...VISOR_REPORTS },
      { path: 'por-facturar',      component: PorFacturarComponent, canActivate: [PermissionGuard], data: { permissions: ['reportes:por-facturar'] } },
    ]),
  ],
})
export class ReportesModule {}
