import { NgModule }           from '@angular/core';
import { CommonModule }       from '@angular/common';
import { RouterModule }       from '@angular/router';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { ReportesHubComponent }  from './reportes-hub.component';
import { PagosBancoComponent }   from './pagos-banco/pagos-banco.component';
import { DepositoIngresosComponent } from './depositos-ingresos/deposito-ingresos.component';
import { SugerenciasConciliacionPanelComponent } from './pagos-banco/components/sugerencias-conciliacion-panel/sugerencias-conciliacion-panel.component';

@NgModule({
  declarations: [ReportesHubComponent, PagosBancoComponent, DepositoIngresosComponent, SugerenciasConciliacionPanelComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild([
      { path: '',                  component: ReportesHubComponent },
      { path: 'pagos-banco',       component: PagosBancoComponent },
      { path: 'depositos-ingresos', component: DepositoIngresosComponent },
    ]),
  ],
})
export class ReportesModule {}
