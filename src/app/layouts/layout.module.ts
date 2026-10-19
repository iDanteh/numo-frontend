import { NgModule }        from '@angular/core';
import { CommonModule }    from '@angular/common';
import { RouterModule }    from '@angular/router';
import { SidebarComponent } from './sidebar/sidebar.component';
import { NotificationBellComponent } from './notification-bell/notification-bell.component';
import { AvisoCredencialesSatComponent } from './aviso-credenciales-sat/aviso-credenciales-sat.component';

@NgModule({
  declarations: [SidebarComponent, NotificationBellComponent, AvisoCredencialesSatComponent],
  imports:      [CommonModule, RouterModule],
  exports:      [SidebarComponent, NotificationBellComponent, AvisoCredencialesSatComponent],
})
export class LayoutModule {}
