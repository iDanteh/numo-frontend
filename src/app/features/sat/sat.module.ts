import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AuthGuard } from '../../core/guards/auth.guard';
import { SatComponent } from './sat.component';
import { CierreDiaComponent } from './cierre-dia/cierre-dia.component';
import { DescargaManualComponent } from './descarga-manual/descarga-manual.component';
import { HistorialSatComponent } from './historial/historial-sat.component';
import { SubirManualComponent } from './subir-manual/subir-manual.component';
import { ProgramacionComponent } from './programacion/programacion.component';
import { MesesAnterioresComponent } from './meses-anteriores/meses-anteriores.component';
import { SaludSatComponent } from './salud/salud-sat.component';

@NgModule({
  declarations: [
    SatComponent,
    CierreDiaComponent,
    DescargaManualComponent,
    HistorialSatComponent,
    SubirManualComponent,
    ProgramacionComponent,
    MesesAnterioresComponent,
    SaludSatComponent,
  ],
  imports: [
    SharedModule,
    RouterModule.forChild([
      {
        path: '',
        component: SatComponent,
        canActivate: [AuthGuard],
        children: [
          { path: '', redirectTo: 'cierre-dia', pathMatch: 'full' },
          { path: 'cierre-dia', component: CierreDiaComponent },
          { path: 'descarga-manual', component: DescargaManualComponent },
          { path: 'subir-manual', component: SubirManualComponent },
          { path: 'historial', component: HistorialSatComponent },
          { path: 'programacion', component: ProgramacionComponent },
          { path: 'meses-anteriores', component: MesesAnterioresComponent },
          { path: 'salud', component: SaludSatComponent },
        ],
      },
    ]),
  ],
})
export class SatModule {}
