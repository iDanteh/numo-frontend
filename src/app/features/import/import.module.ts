import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AuthGuard } from '../../core/guards/auth.guard';
import { ImportComponent } from './import.component';
import { UploadCfdisComponent } from './upload-cfdis/upload-cfdis.component';
import { DriveImportComponent } from './drive-import/drive-import.component';
import { ErpApiImportComponent } from './erp-api-import/erp-api-import.component';

@NgModule({
  declarations: [
    ImportComponent,
    UploadCfdisComponent,
    DriveImportComponent,
    ErpApiImportComponent,
  ],
  imports: [
    SharedModule,
    RouterModule.forChild([
      {
        path: '',
        component: ImportComponent,
        canActivate: [AuthGuard],
        children: [
          { path: '', redirectTo: 'upload', pathMatch: 'full' },
          { path: 'upload', component: UploadCfdisComponent },
          { path: 'drive', component: DriveImportComponent },
          { path: 'erp-api', component: ErpApiImportComponent },
        ],
      },
    ]),
  ],
})
export class ImportModule {}
