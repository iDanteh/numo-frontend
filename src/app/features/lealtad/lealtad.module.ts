import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import {
  LucideDynamicIcon,
  provideLucideIcons,
  LucideArrowLeftRight,
  LucideCreditCard,
  LucideSettings,
  LucideUsers,
  LucideBuilding2,
  LucideActivity,
} from '@lucide/angular';
import { SharedModule } from '../../shared/shared.module';
import { LealtadRoutingModule } from './lealtad-routing.module';

import { LealtadShellComponent } from './shell/lealtad-shell.component';
import { TarjetasListComponent } from './tarjetas/tarjetas-list.component';
import { TarjetaDetailComponent } from './tarjetas/tarjeta-detail.component';
import { TarjetaCreateModalComponent } from './tarjetas/tarjeta-create-modal.component';
import { MovimientoModalComponent } from './tarjetas/movimiento-modal.component';
import { NipRevealModalComponent } from './tarjetas/nip-reveal-modal.component';
import { LealtadConfigComponent } from './configuracion/lealtad-config.component';

@NgModule({
  declarations: [
    LealtadShellComponent,
    TarjetasListComponent,
    TarjetaDetailComponent,
    TarjetaCreateModalComponent,
    MovimientoModalComponent,
    NipRevealModalComponent,
    LealtadConfigComponent,
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    SharedModule,
    LucideDynamicIcon,
    LealtadRoutingModule,
  ],
  providers: [
    // Íconos usados por lealtad-shell.component.html + Administración
    // (shared/config/administracion-nav.config.ts) — mismo criterio por
    // módulo que LayoutModule/BanksModule.
    provideLucideIcons(
      LucideArrowLeftRight,
      LucideCreditCard,
      LucideSettings,
      LucideUsers,
      LucideBuilding2,
      LucideActivity,
    ),
  ],
})
export class LealtadModule {}
