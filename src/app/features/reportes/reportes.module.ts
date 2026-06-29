import { NgModule }           from '@angular/core';
import { CommonModule }       from '@angular/common';
import { RouterModule }       from '@angular/router';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { ReportesHubComponent }  from './reportes-hub.component';
import { PagosBancoComponent }   from './pagos-banco/pagos-banco.component';

@NgModule({
  declarations: [ReportesHubComponent, PagosBancoComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild([
      { path: '',            component: ReportesHubComponent },
      { path: 'pagos-banco', component: PagosBancoComponent },
    ]),
  ],
})
export class ReportesModule {}
