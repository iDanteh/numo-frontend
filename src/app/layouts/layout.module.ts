import { NgModule }        from '@angular/core';
import { CommonModule }    from '@angular/common';
import { RouterModule }    from '@angular/router';
import { SidebarComponent } from './sidebar/sidebar.component';
import { NotificationBellComponent } from './notification-bell/notification-bell.component';

@NgModule({
  declarations: [SidebarComponent, NotificationBellComponent],
  imports:      [CommonModule, RouterModule],
  exports:      [SidebarComponent, NotificationBellComponent],
})
export class LayoutModule {}
